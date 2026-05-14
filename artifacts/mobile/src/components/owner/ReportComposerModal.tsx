/**
 * ReportComposerModal — owner-side inventory report composer & exporter.
 *
 * 2026 Pro Edition. Lets the owner build a tailored inventory report
 * (PDF or Excel) with:
 *   • Required columns (always-on): serial, product name, brand + country
 *     of origin (merged via rowSpan so identical brand+country pairs
 *     don't repeat down the column), SKU, price.
 *   • Optional columns (toggleable): compatible car models (also merged
 *     via rowSpan when identical), fitment indicators rendered as a
 *     horizontal chip row showing only the per-variant price (mirrors
 *     the cart card visual).
 *   • Multi-select filters: car models, product brands, categories,
 *     fuel types.
 *   • Stock status filter: all | in_stock | low_only | out_only |
 *     exclude_out | exclude_low_and_out.
 *   • Grand total toggle: append a "Totals" row to the report or omit it.
 *
 * Implementation notes:
 *   • All data work happens client-side from the products list passed
 *     in by /owner/collection — no extra network calls.
 *   • PDF is rendered with `expo-print` (HTML → PDF), Excel via
 *     `exceljs` + `expo-file-system/legacy` + `expo-sharing`.
 *   • RTL-safe and Arabic-first labels.
 *   • Defensive numeric parsing — Egyptian price strings sometimes
 *     arrive as strings from the API.
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { minutesToHHMM } from '../../utils/timeUtils';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import ExcelJS from 'exceljs';
import { NEON_NIGHT_THEME } from '../../store/appStore';

// Inclusive cell range describing a rectangular merge in a worksheet.
// Coordinates are 0-indexed (row 0 is the header) so the merge math in
// `buildExcelAOA` mirrors the previous `XLSX.Range` shape; we translate
// to ExcelJS's 1-indexed mergeCells call at write time.
type MergeRange = {
  s: { r: number; c: number };
  e: { r: number; c: number };
};

// Convert a binary buffer (Uint8Array / ArrayBuffer / Node Buffer) to a
// base64 string without relying on Node's `Buffer` global — needed for
// React Native where Hermes provides `btoa` but not always `Buffer`.
function bufferToBase64(input: ArrayBuffer | Uint8Array | Buffer): string {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input as ArrayBuffer);
  // Process in chunks so we don't blow the call stack on large workbooks.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

export type ReportStockFilter =
  | 'all'
  | 'in_stock'
  | 'low_only'
  | 'out_only'
  | 'exclude_out'
  | 'exclude_low_and_out';

export interface ReportComposerModalProps {
  visible: boolean;
  onClose: () => void;
  products: any[];
  brands: any[];
  carModels: any[];
  categories?: any[];
  language: string;
}

type ExportFormat = 'pdf' | 'excel';
// Fuel type — accept any string the DB might use. The actual options shown to
// the user are derived from the live `carModels` list at render time so they
// always reflect what's actually present in the inventory (e.g. 'solar',
// 'petrol', 'electric', etc.) instead of a hard-coded subset.
type FuelType = string;

// Localized labels for known fuel types. Anything not in this map shows the
// raw value as-is so brand-new fuel types still render without a code change.
const FUEL_LABELS_AR: Record<string, string> = {
  petrol: 'بنزين',
  diesel: 'ديزل',
  electric: 'كهربائي',
  hybrid: 'هايبرد',
  solar: 'سولار',
  equipment: 'معدات',
  gas: 'غاز',
};
const FUEL_LABELS_EN: Record<string, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  electric: 'Electric',
  hybrid: 'Hybrid',
  solar: 'Solar',
  equipment: 'Equipment',
  gas: 'Gas',
};
const fuelLabelOf = (key: string, isAr: boolean): string => {
  const map = isAr ? FUEL_LABELS_AR : FUEL_LABELS_EN;
  return map[key] ?? key;
};

// ─── Defensive helpers ───────────────────────────────────────────────────────
const safeStr = (v: any, fallback = ''): string => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length > 0 ? s : fallback;
};

const safeNum = (v: any): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const stockOf = (p: any): number =>
  safeNum(p?.stock_quantity ?? p?.stock ?? 0);

const escapeHTML = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ─── SKU grouping ────────────────────────────────────────────────────────────
// Collapse fitment-variant rows (same SKU, different fitment) into one logical
// product so the report shows the indicator strip on a single line instead of
// repeating the product name once per fitment.
type Variant = { indicator: string; price: number; stock: number };
type SkuGroup = {
  sku: string;
  primary: any;
  variants: Variant[];
  totalStock: number;
  // The "representative" price for filter/sort/totals — the primary fitment.
  basePrice: number;
};

const FITMENT_ORDER: Record<string, number> = { STD: 0, '010': 1, '020': 2, '030': 3 };
const fitmentRank = (ind: string | null | undefined): number => {
  const k = (ind || 'STD').toUpperCase();
  return FITMENT_ORDER[k] ?? 99;
};

function groupBySku(products: any[]): SkuGroup[] {
  const seenIds = new Set<string>();
  const bySku = new Map<string, any[]>();
  const order: string[] = [];
  for (const p of products) {
    const pid = String(p?.id ?? '');
    if (!pid || seenIds.has(pid)) continue;
    seenIds.add(pid);
    const skuRaw = p?.sku ? String(p.sku).trim().toUpperCase() : '';
    const sku = skuRaw || `__pid:${pid}`;
    if (!bySku.has(sku)) {
      bySku.set(sku, []);
      order.push(sku);
    }
    bySku.get(sku)!.push(p);
  }
  return order.map((sku) => {
    const rows = bySku.get(sku)!.sort(
      (a, b) => fitmentRank(a?.fitment_indicator) - fitmentRank(b?.fitment_indicator),
    );
    const primary = rows[0];
    const variants: Variant[] = rows.map((r) => ({
      indicator: (r?.fitment_indicator || 'STD').toUpperCase(),
      price: safeNum(r?.price),
      stock: stockOf(r),
    }));
    const totalStock = variants.reduce((s, v) => s + v.stock, 0);
    return {
      sku: sku.startsWith('__pid:') ? '' : sku,
      primary,
      variants,
      totalStock,
      basePrice: safeNum(primary?.price),
    };
  });
}

// ─── Brand+Country & Models cell builders ────────────────────────────────────
function brandLabel(p: any, brands: any[], isAr: boolean): { brand: string; country: string; combined: string } {
  const b = brands.find((br: any) => br.id === p?.product_brand_id);
  const brand = b
    ? isAr
      ? safeStr(b.name_ar, safeStr(b.name, '—'))
      : safeStr(b.name, safeStr(b.name_ar, '—'))
    : '—';
  // Country may live on the product (snapshot) or on the brand row.
  const countryRaw = isAr
    ? safeStr(p?.manufacturer_country_ar, safeStr(p?.country_of_origin_ar, safeStr(b?.country_of_origin_ar, safeStr(b?.country_of_origin, ''))))
    : safeStr(p?.manufacturer_country, safeStr(p?.country_of_origin, safeStr(b?.country_of_origin, safeStr(b?.country_of_origin_ar, ''))));
  const country = countryRaw || '';
  const combined = country ? `${brand} · ${country}` : brand;
  return { brand, country, combined };
}

function modelsList(p: any, carModels: any[], isAr: boolean): string[] {
  const ids: any[] = Array.isArray(p?.car_model_ids) ? p.car_model_ids : [];
  return ids
    .map((mid: string) => {
      const m = carModels.find((cm: any) => cm.id === mid);
      if (!m) return null;
      return isAr ? m.name_ar || m.name : m.name || m.name_ar;
    })
    .filter(Boolean) as string[];
}

// Merge identical adjacent groups by a key (returns rowspan map).
function buildRowSpans(rows: SkuGroup[], keyOf: (g: SkuGroup) => string): Map<number, number> {
  // Map of starting-row-index → rowspan count. Non-leading rows are excluded
  // entirely so the renderer knows to skip emitting the cell.
  const spans = new Map<number, number>();
  let i = 0;
  while (i < rows.length) {
    const k = keyOf(rows[i]);
    let j = i + 1;
    while (j < rows.length && keyOf(rows[j]) === k) j++;
    spans.set(i, j - i);
    i = j;
  }
  return spans;
}

// ─── Product-type labels & icons (shared by modal + PDF + Excel) ──────────────
// Keep this list authoritative for the four product-type buckets the system
// supports. NULL/missing product_type is treated as 'regular' so legacy rows
// without an explicit type still appear under the standard bucket.
type ProductTypeKey = 'regular' | 'tire' | 'accessory' | 'exterior';
const PRODUCT_TYPE_LABELS_AR: Record<ProductTypeKey, string> = {
  regular: 'منتج عادي',
  tire: 'إطارات',
  accessory: 'إكسسوارات',
  exterior: 'الهيكل الخارجي',
};
const PRODUCT_TYPE_LABELS_EN: Record<ProductTypeKey, string> = {
  regular: 'Standard',
  tire: 'Tires',
  accessory: 'Accessories',
  exterior: 'Exterior body',
};
// PDF/Excel-safe symbol for each bucket (no font dependency on Ionicons in print).
const PRODUCT_TYPE_GLYPHS: Record<ProductTypeKey, string> = {
  regular: '◆',
  tire: '◯',
  accessory: '✦',
  exterior: '◧',
};
const PRODUCT_TYPE_COLORS: Record<ProductTypeKey, string> = {
  regular: '#6366F1',
  tire: '#0EA5E9',
  accessory: '#F59E0B',
  exterior: '#10B981',
};
// Ionicons names used inside the modal's filter chips. Kept separate from the
// PDF glyphs above because Ionicons fonts are not embedded in the printed HTML.
const PRODUCT_TYPE_ICONS: Record<ProductTypeKey, string> = {
  regular: 'cube-outline',
  tire: 'ellipse-outline',
  accessory: 'sparkles-outline',
  exterior: 'storefront-outline',
};
const productTypeKey = (raw: any): ProductTypeKey => {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'tire' || v === 'accessory' || v === 'exterior') return v;
  return 'regular';
};
const productTypeLabel = (raw: any, isAr: boolean): string => {
  const k = productTypeKey(raw);
  return (isAr ? PRODUCT_TYPE_LABELS_AR : PRODUCT_TYPE_LABELS_EN)[k];
};

// ─── Opening-hours formatter (year_start/year_end stored as minutes-since-midnight)
// Returns undefined when both ends are missing so the caller can skip rendering.
const formatYearRange = (model: any, isAr: boolean): string | undefined => {
  const rawStart = model?.year_start;
  const rawEnd = model?.year_end;
  const start = rawStart != null && rawStart !== '' ? Number(rawStart) : null;
  const end = rawEnd != null && rawEnd !== '' ? Number(rawEnd) : null;
  const openStr = (start !== null && Number.isFinite(start)) ? minutesToHHMM(start) : null;
  const closeStr = (end !== null && Number.isFinite(end)) ? minutesToHHMM(end) : null;
  if (!openStr && !closeStr) return undefined;
  if (openStr && closeStr) return isAr ? `فتح ${openStr} — إغلاق ${closeStr}` : `Open ${openStr} — Close ${closeStr}`;
  if (openStr) return isAr ? `فتح ${openStr}` : `Open ${openStr}`;
  return isAr ? `إغلاق ${closeStr}` : `Close ${closeStr}`;
};

// ─── PDF generator ───────────────────────────────────────────────────────────
type ReportConfig = {
  showModels: boolean;
  showFitments: boolean;
  showGrandTotal: boolean;
  // New optional/visual toggles requested by the owner.
  showProductType: boolean;     // adds a smart-merged "Product Type" column.
  showStockIndicator: boolean;  // shows the small ×N badge under the product name.
  showSummaryBar: boolean;      // toggles the top summary stats strip in the PDF.
};

function buildPdfHTML(
  rows: SkuGroup[],
  brands: any[],
  carModels: any[],
  cfg: ReportConfig,
  isAr: boolean,
): string {
  const dir = isAr ? 'rtl' : 'ltr';
  const labels = isAr
    ? {
        title: 'تقرير المخزون',
        company: 'مطعم الغزالي للمأكولات الفاخرة',
        generated: 'تاريخ التوليد',
        totalProducts: 'إجمالي المنتجات',
        totalStock: 'إجمالي المخزون',
        totalValue: 'إجمالي القيمة',
        outOfStock: 'نفد من المخزون',
        lowStock: 'مخزون منخفض',
        currency: 'ج.م',
        grandTotal: 'الإجمالي الكلي',
        // Required columns are always shown; optional ones only when toggled.
        col_serial: '#',
        col_name: 'اسم المنتج',
        col_brand: 'الماركة وبلد المنشأ',
        col_sku: 'رقم المنتج',
        col_price: 'السعر',
        col_models: 'المطاعم المتوافقة',
        col_fitments: 'مؤشرات التوافق',
        col_product_type: 'نوع المنتج',
        none: '—',
      }
    : {
        title: 'Inventory Report',
        company: 'Al-Ghazaly Fine Dining',
        generated: 'Generated',
        totalProducts: 'Total products',
        totalStock: 'Total stock',
        totalValue: 'Total value',
        outOfStock: 'Out of stock',
        lowStock: 'Low stock',
        currency: 'EGP',
        grandTotal: 'Grand Total',
        col_serial: '#',
        col_name: 'Product Name',
        col_brand: 'Brand & Country of Origin',
        col_sku: 'SKU',
        col_price: 'Price',
        col_models: 'Compatible Restaurants',
        col_fitments: 'Fitment Indicators',
        col_product_type: 'Product Type',
        none: '—',
      };

  const totalProducts = rows.length;
  const totalStock = rows.reduce((s, r) => s + r.totalStock, 0);
  // Total value = Σ (variant.price × variant.stock) so fitment pricing is honoured.
  const totalValue = rows.reduce(
    (s, r) => s + r.variants.reduce((a, v) => a + v.price * v.stock, 0),
    0,
  );
  const outOfStock = rows.filter((r) => r.totalStock === 0).length;
  const lowStock = rows.filter((r) => r.totalStock > 0 && r.totalStock < 10).length;

  const now = new Date();
  const generated = now.toLocaleString(isAr ? 'ar-EG' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Pre-compute brand+country and model lists, then compute rowSpans so
  // identical adjacent values render as one merged cell. The model field
  // emits a 2-line HTML fragment (name + small year range) so we keep a
  // separate plain-text key for run-detection (so a model that appears
  // twice with the same year range merges correctly even though its HTML
  // would technically be identical).
  const meta = rows.map((g) => {
    const bc = brandLabel(g.primary, brands, isAr);
    const ids: string[] = Array.isArray(g.primary?.car_model_ids) ? g.primary.car_model_ids : [];
    const modelObjs: any[] = ids
      .map((mid) => carModels.find((cm: any) => cm.id === mid))
      .filter(Boolean) as any[];
    const ms = modelObjs.map((m: any) => isAr ? (m.name_ar || m.name || '') : (m.name || m.name_ar || ''));
    // Build the rendered model HTML — each model name is followed by a
    // small dimmed year range (e.g. "تويوتا كورولا" + "2018 - 2022").
    const modelsHtml = modelObjs.length === 0
      ? labels.none
      : modelObjs.map((m: any, idx: number) => {
          const nm = isAr ? (m.name_ar || m.name || '') : (m.name || m.name_ar || '');
          const yr = formatYearRange(m, isAr);
          const sep = idx === 0 ? '' : '<span class="model-sep"> · </span>';
          return `${sep}<span class="model-item"><span class="model-name">${escapeHTML(nm)}</span>${yr ? `<span class="model-years">${escapeHTML(yr)}</span>` : ''}</span>`;
        }).join('');
    const modelsKey = ms.join(' · ') || labels.none; // plain key for merge detection
    return {
      brandCombined: bc.combined,
      brandHtml: bc.brand,
      countryHtml: bc.country,
      modelsKey,
      modelsHtml,
      productType: productTypeKey(g.primary?.product_type),
      productTypeLabel: productTypeLabel(g.primary?.product_type, isAr),
    };
  });
  const brandSpans = buildRowSpans(rows, (_g) => meta[rows.indexOf(_g)].brandCombined);
  const modelSpans = cfg.showModels ? buildRowSpans(rows, (_g) => meta[rows.indexOf(_g)].modelsKey) : new Map<number, number>();
  // Product-type rowSpans — rows are already sorted by product_type first,
  // so the merge runs are guaranteed to be contiguous.
  const productTypeSpans = cfg.showProductType
    ? buildRowSpans(rows, (_g) => meta[rows.indexOf(_g)].productType)
    : new Map<number, number>();

  // Total column count for grand-total row colspan
  let colCount = 5; // serial + name + brand + sku + price
  if (cfg.showModels) colCount++;
  if (cfg.showFitments) colCount++;
  if (cfg.showProductType) colCount++;

  const trList = rows
    .map((g, i) => {
      const m = meta[i];
      const stockColor = g.totalStock === 0 ? '#EF4444' : g.totalStock < 10 ? '#F59E0B' : '#10B981';
      const priceCell = `${g.basePrice.toFixed(2)} ${labels.currency}`;
      // Stock badge is gated on cfg.showStockIndicator — owners printing the
      // report for end-customers can hide the small ×N pill for a cleaner look.
      const stockBadge = cfg.showStockIndicator
        ? `<span class="stock-badge" style="background:${stockColor}20;color:${stockColor};border:1px solid ${stockColor}55">×${g.totalStock}</span>`
        : '';

      // Product-type merged cell — leading row of a run carries the rowspan.
      let productTypeCell = '';
      if (cfg.showProductType) {
        const lead = productTypeSpans.has(i);
        const span = productTypeSpans.get(i) || 0;
        if (lead) {
          const ptColor = PRODUCT_TYPE_COLORS[m.productType];
          productTypeCell = `<td class="ptype-cell" rowspan="${span}"><span class="ptype-pill" style="background:${ptColor}1A;color:${ptColor};border:1px solid ${ptColor}55">${escapeHTML(m.productTypeLabel)}</span></td>`;
        }
      }

      // Brand+country merged cell — only emitted on the leading row of a run.
      const brandLead = brandSpans.has(i);
      const brandSpan = brandSpans.get(i) || 0;
      const brandCell = brandLead
        ? `<td class="brand-cell" rowspan="${brandSpan}"><div class="brand-line">${escapeHTML(m.brandHtml)}</div>${m.countryHtml ? `<div class="country-line">${escapeHTML(m.countryHtml)}</div>` : ''}</td>`
        : '';

      // Models cell — same logic if optional column is enabled. The HTML
      // already encodes its own escaping (model names + dimmed year ranges).
      let modelsCell = '';
      if (cfg.showModels) {
        const lead = modelSpans.has(i);
        const span = modelSpans.get(i) || 0;
        modelsCell = lead
          ? `<td class="models-cell" rowspan="${span}">${m.modelsHtml}</td>`
          : '';
      }

      // Fitment chips row — horizontal pills, indicator + price below.
      let fitmentCell = '';
      if (cfg.showFitments) {
        const chips = g.variants
          .map((v) => {
            const oos = v.stock === 0;
            const indColor = oos ? '#94A3B8' : '#6366F1';
            const indBg = oos ? 'rgba(148,163,184,0.10)' : 'rgba(99,102,241,0.10)';
            const indBorder = oos ? 'rgba(148,163,184,0.30)' : 'rgba(99,102,241,0.30)';
            return `<span class="fitment-chip" style="background:${indBg};border-color:${indBorder};color:${indColor};">
              <span class="fc-ind">${escapeHTML(v.indicator)}</span>
              <span class="fc-price">${v.price.toFixed(0)} ${labels.currency}</span>
            </span>`;
          })
          .join('');
        fitmentCell = `<td class="fitment-cell"><div class="fitment-row">${chips}</div></td>`;
      }

      // Required column order (per owner spec):
      //   serial → name → SKU → price → brand+country
      // Optional columns appended after the required block, in this order:
      //   [models] → [productType] → [fitments]
      return `
        <tr class="product-row">
          <td class="num">${i + 1}</td>
          <td class="name-cell"><div class="name-main">${escapeHTML(safeStr(isAr ? g.primary?.name_ar : g.primary?.name, safeStr(isAr ? g.primary?.name : g.primary?.name_ar, labels.none)))}</div>${stockBadge}</td>
          <td class="mono">${escapeHTML(g.sku || labels.none)}</td>
          <td class="num bold">${priceCell}</td>
          ${brandCell}
          ${modelsCell}
          ${productTypeCell}
          ${fitmentCell}
        </tr>
      `;
    })
    .join('\n');

  const grandTotalRow = cfg.showGrandTotal
    ? `<tr class="totals-row">
        <td colspan="${colCount - 1}" class="totals-label">${escapeHTML(labels.grandTotal)} (${escapeHTML(labels.totalStock)}: ${totalStock})</td>
        <td class="num bold totals-value">${totalValue.toFixed(2)} ${labels.currency}</td>
      </tr>`
    : '';

  // Header cells — order must match the body cells emitted above:
  // serial → name → sku → price → brand → [models] → [productType] → [fitments].
  const headers = [
    `<th>${escapeHTML(labels.col_serial)}</th>`,
    `<th>${escapeHTML(labels.col_name)}</th>`,
    `<th>${escapeHTML(labels.col_sku)}</th>`,
    `<th>${escapeHTML(labels.col_price)}</th>`,
    `<th>${escapeHTML(labels.col_brand)}</th>`,
  ];
  if (cfg.showModels) headers.push(`<th>${escapeHTML(labels.col_models)}</th>`);
  if (cfg.showProductType) headers.push(`<th>${escapeHTML(labels.col_product_type)}</th>`);
  if (cfg.showFitments) headers.push(`<th>${escapeHTML(labels.col_fitments)}</th>`);

  return `<!DOCTYPE html>
<html lang="${isAr ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="UTF-8" />
<title>${escapeHTML(labels.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Cairo", "Tajawal", Tahoma, sans-serif; color: #0F172A; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .header {
    background: linear-gradient(135deg, #0F172A 0%, #1E293B 45%, #312E81 100%);
    color: #FFF; padding: 22px 28px; border-radius: 14px; margin-bottom: 16px;
    position: relative; overflow: hidden;
  }
  .header::after { content: ''; position: absolute; top: -40px; ${isAr ? 'left' : 'right'}: -40px; width: 180px; height: 180px; background: rgba(99,102,241,0.18); border-radius: 50%; }
  .h-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; position: relative; }
  .h-title { font-size: 24px; font-weight: 800; margin: 0 0 4px; letter-spacing: 0.3px; }
  .h-sub { font-size: 12px; opacity: 0.85; }
  .h-meta { font-size: 11px; opacity: 0.7; text-align: ${isAr ? 'left' : 'right'}; }

  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 16px; }
  .stat { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 10px; padding: 11px 14px; }
  .stat-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px; }
  .stat-val { font-size: 18px; font-weight: 800; color: #0F172A; }
  .stat-ok .stat-val { color: #10B981; }
  .stat-warn .stat-val { color: #F59E0B; }
  .stat-err .stat-val { color: #EF4444; }

  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; }
  thead th {
    background: linear-gradient(135deg, #1E293B, #0F172A); color: #FFF; padding: 10px 10px;
    text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  td { padding: 10px 10px; border-top: 1.5px solid #94A3B8; vertical-align: middle; }
  tbody tr:first-child td { border-top: none; }
  /* Thin visible separator under every product row so each SKU group is
     clearly delineated even when adjacent rows share merged brand/models
     cells. Uses slate-400 to stay subtle but readable. */
  tbody tr.product-row td { border-bottom: 1px solid #CBD5E1; }
  tbody tr.product-row:last-child td { border-bottom: none; }
  .num { text-align: ${isAr ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
  .mono { font-family: "SF Mono", Menlo, monospace; font-size: 10px; color: #475569; letter-spacing: 0.3px; }
  .bold { font-weight: 700; }
  .name-cell { max-width: 260px; }
  .name-main { font-weight: 700; color: #0F172A; margin-bottom: 4px; line-height: 1.35; }
  .stock-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; }
  .brand-cell { background: #FAFBFF; vertical-align: middle; }
  .brand-line { font-weight: 700; color: #4F46E5; font-size: 12px; }
  .country-line { font-size: 10px; color: #64748B; margin-top: 2px; }
  .models-cell { color: #475569; max-width: 240px; line-height: 1.5; background: #F8FAFC; }
  .model-item { display: inline-block; margin: 1px 0; }
  .model-name { font-weight: 600; color: #334155; }
  .model-years { display: inline-block; margin-${isAr ? 'right' : 'left'}: 6px; padding: 1px 6px; border-radius: 4px; background: #E2E8F0; color: #64748B; font-size: 9px; font-weight: 700; letter-spacing: 0.3px; vertical-align: middle; }
  .model-sep { color: #CBD5E1; font-weight: 700; }
  .ptype-cell { background: #FAFAFF; vertical-align: middle; text-align: center; }
  .ptype-pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 10px; font-weight: 800; letter-spacing: 0.3px; }
  tbody tr:nth-child(even) .ptype-cell { background: #F4F4FF; }
  .fitment-cell { min-width: 220px; }
  .fitment-row {
    display: flex; flex-wrap: wrap; gap: 5px; align-items: center;
    ${isAr ? 'justify-content: flex-end;' : ''}
  }
  .fitment-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 9px; border-radius: 999px; border: 1px solid;
    font-size: 10px; font-weight: 700;
  }
  .fc-ind { letter-spacing: 0.5px; }
  .fc-price { font-weight: 800; opacity: 0.9; padding-${isAr ? 'right' : 'left'}: 4px; border-${isAr ? 'right' : 'left'}: 1px solid currentColor; }
  tbody tr:nth-child(even) td { background: #FCFDFE; }
  tbody tr:nth-child(even) .brand-cell { background: #F4F5FF; }
  tbody tr:nth-child(even) .models-cell { background: #F2F6FA; }

  .totals-row td { background: #F1F5F9 !important; padding: 12px 14px; font-size: 13px; font-weight: 800; border-top: 2px solid #6366F1; }
  .totals-label { color: #1E293B; }
  .totals-value { color: #6366F1; font-size: 16px; }

  .footer { margin-top: 14px; padding-top: 10px; border-top: 1px solid #E5E7EB; font-size: 10px; color: #64748B; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <div class="h-row">
      <div>
        <div class="h-title">${escapeHTML(labels.title)}</div>
        <div class="h-sub">${escapeHTML(labels.company)}</div>
      </div>
      <div class="h-meta">${escapeHTML(labels.generated)}: ${escapeHTML(generated)}</div>
    </div>
  </div>

  ${cfg.showSummaryBar ? `<div class="summary">
    <div class="stat"><div class="stat-lbl">${escapeHTML(labels.totalProducts)}</div><div class="stat-val">${totalProducts}</div></div>
    <div class="stat"><div class="stat-lbl">${escapeHTML(labels.totalStock)}</div><div class="stat-val">${totalStock}</div></div>
    <div class="stat stat-ok"><div class="stat-lbl">${escapeHTML(labels.totalValue)}</div><div class="stat-val">${totalValue.toFixed(2)} ${escapeHTML(labels.currency)}</div></div>
    <div class="stat stat-err"><div class="stat-lbl">${escapeHTML(labels.outOfStock)}</div><div class="stat-val">${outOfStock}</div></div>
    <div class="stat stat-warn"><div class="stat-lbl">${escapeHTML(labels.lowStock)}</div><div class="stat-val">${lowStock}</div></div>
  </div>` : ''}

  <table>
    <thead><tr>${headers.join('')}</tr></thead>
    <tbody>${trList}${grandTotalRow}</tbody>
  </table>

  <div class="footer">${escapeHTML(labels.company)} &middot; ${escapeHTML(labels.title)}</div>
</body>
</html>`;
}

// ─── Excel generator ─────────────────────────────────────────────────────────
function buildExcelAOA(
  rows: SkuGroup[],
  brands: any[],
  carModels: any[],
  cfg: ReportConfig,
  isAr: boolean,
): { aoa: any[][]; merges: MergeRange[]; cols: { wch: number }[]; sheetName: string } {
  const labels = isAr
    ? {
        sheet: 'المخزون',
        col_serial: '#',
        col_name: 'اسم المنتج',
        col_brand: 'الماركة وبلد المنشأ',
        col_sku: 'رقم المنتج',
        col_price: 'السعر',
        col_models: 'المطاعم المتوافقة',
        col_fitments: 'مؤشرات التوافق',
        col_product_type: 'نوع المنتج',
        grand: 'الإجمالي الكلي',
        currency: 'ج.م',
      }
    : {
        sheet: 'Inventory',
        col_serial: '#',
        col_name: 'Product Name',
        col_brand: 'Brand & Country of Origin',
        col_sku: 'SKU',
        col_price: 'Price',
        col_models: 'Compatible Restaurants',
        col_fitments: 'Fitment Indicators',
        col_product_type: 'Product Type',
        grand: 'Grand Total',
        currency: 'EGP',
      };

  // Header layout matches the PDF: serial → name → sku → price → brand →
  // [models] → [productType] → [fitments]. Column indices below are derived
  // from the same conditional layout so the merge ranges stay aligned.
  const headers: string[] = [
    labels.col_serial,
    labels.col_name,
    labels.col_sku,
    labels.col_price,
    labels.col_brand,
  ];
  if (cfg.showModels) headers.push(labels.col_models);
  if (cfg.showProductType) headers.push(labels.col_product_type);
  if (cfg.showFitments) headers.push(labels.col_fitments);

  const meta = rows.map((g) => {
    const bc = brandLabel(g.primary, brands, isAr);
    const ids: string[] = Array.isArray(g.primary?.car_model_ids) ? g.primary.car_model_ids : [];
    // Build "ModelName (year_start - year_end)" strings — year suffix only
    // when the model carries year metadata.
    const modelStrs: string[] = ids
      .map((mid) => carModels.find((cm: any) => cm.id === mid))
      .filter(Boolean)
      .map((m: any) => {
        const nm = isAr ? (m.name_ar || m.name || '') : (m.name || m.name_ar || '');
        const yr = formatYearRange(m, isAr);
        return yr ? `${nm} (${yr})` : nm;
      });
    return {
      brandCombined: bc.combined,
      models: modelStrs.join(' · ') || '',
      productType: productTypeKey(g.primary?.product_type),
      productTypeLabel: productTypeLabel(g.primary?.product_type, isAr),
    };
  });

  const aoa: any[][] = [headers];

  // Track merge ranges (Excel-style {s:{r,c}, e:{r,c}}). Column indices are
  // computed from the conditional header layout: fixed cols are
  //   0=serial 1=name 2=sku 3=price 4=brand
  // optional cols append in order: [models] → [productType] → [fitments].
  const merges: MergeRange[] = [];
  const brandColIdx = 4;
  const modelsColIdx = cfg.showModels ? 5 : -1;
  const productTypeColIdx = cfg.showProductType ? (5 + (cfg.showModels ? 1 : 0)) : -1;

  // Helper to walk runs of identical adjacent values for column-merge.
  const buildRuns = (keyOf: (i: number) => string) => {
    const runs: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i < rows.length) {
      const k = keyOf(i);
      let j = i + 1;
      while (j < rows.length && keyOf(j) === k) j++;
      runs.push({ start: i, end: j - 1 });
      i = j;
    }
    return runs;
  };

  const brandRuns = buildRuns((i) => meta[i].brandCombined);
  const modelRuns = cfg.showModels ? buildRuns((i) => meta[i].models) : [];
  const productTypeRuns = cfg.showProductType ? buildRuns((i) => meta[i].productType) : [];

  rows.forEach((g, i) => {
    const name = isAr
      ? safeStr(g.primary?.name_ar, safeStr(g.primary?.name, ''))
      : safeStr(g.primary?.name, safeStr(g.primary?.name_ar, ''));
    // Order matches the headers: serial, name, sku, price, brand,
    // [models], [productType], [fitments].
    const row: any[] = [i + 1, name, g.sku || '', g.basePrice, meta[i].brandCombined];
    if (cfg.showModels) row.push(meta[i].models);
    if (cfg.showProductType) row.push(meta[i].productTypeLabel);
    if (cfg.showFitments) {
      const chips = g.variants
        .map((v) => `${v.indicator}: ${v.price.toFixed(0)} ${labels.currency}`)
        .join('  |  ');
      row.push(chips);
    }
    aoa.push(row);
  });

  // Add merges (1-indexed offset because row 0 is the header).
  brandRuns.forEach((r) => {
    if (r.end > r.start) merges.push({ s: { r: r.start + 1, c: brandColIdx }, e: { r: r.end + 1, c: brandColIdx } });
  });
  if (cfg.showModels) {
    modelRuns.forEach((r) => {
      if (r.end > r.start) merges.push({ s: { r: r.start + 1, c: modelsColIdx }, e: { r: r.end + 1, c: modelsColIdx } });
    });
  }
  if (cfg.showProductType) {
    productTypeRuns.forEach((r) => {
      if (r.end > r.start) merges.push({ s: { r: r.start + 1, c: productTypeColIdx }, e: { r: r.end + 1, c: productTypeColIdx } });
    });
  }

  // Optional grand total row — anchored to the Price column (idx 3) so the
  // value lines up directly under it. Layout: serial(0) name(1) sku(2)
  // price(3) brand(4) [models] [productType] [fitments].
  if (cfg.showGrandTotal) {
    const totalValue = rows.reduce(
      (s, r) => s + r.variants.reduce((a, v) => a + v.price * v.stock, 0),
      0,
    );
    aoa.push([]);
    // serial, name, sku → label spread; price column carries the total value.
    const totalsRow: any[] = [labels.grand, '', '', totalValue, ''];
    if (cfg.showModels) totalsRow.push('');
    if (cfg.showProductType) totalsRow.push('');
    if (cfg.showFitments) totalsRow.push('');
    aoa.push(totalsRow);
  }

  // Sensible column widths matching the new column order.
  const cols: { wch: number }[] = [
    { wch: 5 },   // serial
    { wch: 36 }, // name
    { wch: 14 }, // sku
    { wch: 12 }, // price
    { wch: 28 }, // brand+country
  ];
  if (cfg.showModels) cols.push({ wch: 36 });        // models (a bit wider for years)
  if (cfg.showProductType) cols.push({ wch: 14 });  // product type
  if (cfg.showFitments) cols.push({ wch: 38 });

  return { aoa, merges, cols, sheetName: labels.sheet };
}

// ─── UI: pill chip for filter sections ───────────────────────────────────────
const FilterChip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  subLabel?: string; // optional secondary line (e.g. "2018 - 2024" for car models)
}> = ({ label, selected, onPress, count, subLabel }) => (
  <Pressable
    onPress={onPress}
    style={[
      styles.chip,
      selected && { backgroundColor: NEON_NIGHT_THEME.primary, borderColor: NEON_NIGHT_THEME.primary },
    ]}
  >
    {subLabel ? (
      <View style={styles.chipColumn}>
        <Text style={[styles.chipText, selected && { color: '#FFF' }]} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.chipSubText, selected && { color: 'rgba(255,255,255,0.85)' }]}
          numberOfLines={1}
        >
          {subLabel}
        </Text>
      </View>
    ) : (
      <Text style={[styles.chipText, selected && { color: '#FFF' }]} numberOfLines={1}>
        {label}
      </Text>
    )}
    {typeof count === 'number' && (
      <View style={[styles.chipCount, selected && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
        <Text style={[styles.chipCountText, selected && { color: '#FFF' }]}>{count}</Text>
      </View>
    )}
  </Pressable>
);

// ─── Component ───────────────────────────────────────────────────────────────
export const ReportComposerModal: React.FC<ReportComposerModalProps> = ({
  visible,
  onClose,
  products,
  brands,
  carModels,
  categories = [],
  language,
}) => {
  const isAr = language === 'ar';
  const [working, setWorking] = useState<ExportFormat | null>(null);

  // ── Optional column toggles ─────────────────────────────────────────────────
  const [showModels, setShowModels] = useState(true);
  const [showFitments, setShowFitments] = useState(true);
  const [showGrandTotal, setShowGrandTotal] = useState(true);
  // Product Type column — defaults ON because it gives a quick visual segmentation
  // (regular vs tires vs accessories vs exterior body) and merges identical
  // adjacent rows so it adds visual structure without bloating the report.
  const [showProductType, setShowProductType] = useState(true);
  // Stock indicator — the small "×N" badge rendered under the product name.
  // Defaults ON to preserve existing behavior; toggling OFF gives a cleaner
  // name column when the owner just wants the listing without quantity noise.
  const [showStockIndicator, setShowStockIndicator] = useState(true);
  // Top summary stats strip in the PDF (totalProducts/totalStock/totalValue/
  // outOfStock/lowStock). Defaults ON; toggling OFF gives a leaner report
  // that jumps straight from the header to the products table.
  const [showSummaryBar, setShowSummaryBar] = useState(true);

  // ── Multi-select filters ────────────────────────────────────────────────────
  const [selBrands, setSelBrands] = useState<Set<string>>(new Set());
  const [selCategories, setSelCategories] = useState<Set<string>>(new Set());
  const [selCarModels, setSelCarModels] = useState<Set<string>>(new Set());
  const [selFuelTypes, setSelFuelTypes] = useState<Set<FuelType>>(new Set());
  // Product-type multi-select — values are 'regular' | 'tire' | 'accessory'
  // | 'exterior'. Empty set means "no filter" (i.e. include everything).
  const [selProductTypes, setSelProductTypes] = useState<Set<ProductTypeKey>>(new Set());
  const [stockFilter, setStockFilter] = useState<ReportStockFilter>('all');

  // Reset state when modal becomes invisible so re-open feels fresh.
  useEffect(() => {
    if (!visible) {
      // Defer reset slightly so the close animation doesn't show empty UI.
      const t = setTimeout(() => setWorking(null), 200);
      return () => clearTimeout(t);
    }
  }, [visible]);

  const toggleSet = useCallback(<T extends string>(setter: React.Dispatch<React.SetStateAction<Set<T>>>) => {
    return (id: T) => {
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };
  }, []);

  // ── Filtered & grouped products ─────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    let list = products;

    if (selBrands.size > 0) {
      list = list.filter((p: any) => selBrands.has(String(p?.product_brand_id || '')));
    }
    if (selCategories.size > 0) {
      list = list.filter((p: any) => selCategories.has(String(p?.category_id || '')));
    }
    if (selCarModels.size > 0) {
      list = list.filter((p: any) =>
        Array.isArray(p?.car_model_ids) && p.car_model_ids.some((mid: string) => selCarModels.has(mid)),
      );
    }
    if (selFuelTypes.size > 0) {
      // Normalize stored fuel_type strings to lowercase so comparisons are
      // case-insensitive (DB rows occasionally use mixed casing).
      const allowedModelIds = new Set(
        carModels
          .filter((m: any) => selFuelTypes.has(String(m?.fuel_type ?? '').toLowerCase()))
          .map((m: any) => String(m.id)),
      );
      list = list.filter((p: any) =>
        Array.isArray(p?.car_model_ids) && p.car_model_ids.some((mid: string) => allowedModelIds.has(mid)),
      );
    }
    if (selProductTypes.size > 0) {
      // NULL/missing product_type collapses to 'regular' so legacy rows show
      // up under the standard bucket instead of being silently filtered out.
      list = list.filter((p: any) => selProductTypes.has(productTypeKey(p?.product_type)));
    }

    return list;
  }, [products, selBrands, selCategories, selCarModels, selFuelTypes, selProductTypes, carModels]);

  const groups = useMemo(() => groupBySku(filteredProducts), [filteredProducts]);

  // Apply stock filter at the SKU-group level so a multi-fitment product is
  // judged by the sum of its fitment stocks (matches the cards on screen).
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      const s = g.totalStock;
      switch (stockFilter) {
        case 'all': return true;
        case 'in_stock': return s > 0;
        case 'low_only': return s > 0 && s < 10;
        case 'out_only': return s === 0;
        case 'exclude_out': return s > 0;
        case 'exclude_low_and_out': return s >= 10;
      }
    });
  }, [groups, stockFilter]);

  // Then sort by brand+country so the rowSpan merge in the PDF is contiguous.
  // Sort priority: product_type → brand+country → product name. Putting the
  // product_type bucket first means rows of the same type are contiguous, so
  // the new "Product Type" column in the report can use rowSpan/merge to
  // collapse identical adjacent rows into a single labelled bucket.
  const sortedGroups = useMemo(() => {
    // Pre-compute the keys for each row once so the sort comparator stays cheap.
    const meta = filteredGroups.map((g) => ({
      pt: productTypeKey(g.primary?.product_type),
      brand: brandLabel(g.primary, brands, isAr).combined,
      name: isAr ? (g.primary?.name_ar || '') : (g.primary?.name || ''),
    }));
    // Stable secondary order: regular → tire → accessory → exterior.
    const ptOrder: Record<ProductTypeKey, number> = { regular: 0, tire: 1, accessory: 2, exterior: 3 };
    const indices = filteredGroups.map((_, i) => i);
    indices.sort((a, b) => {
      const pa = ptOrder[meta[a].pt];
      const pb = ptOrder[meta[b].pt];
      if (pa !== pb) return pa - pb;
      const ka = meta[a].brand; const kb = meta[b].brand;
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return String(meta[a].name).localeCompare(String(meta[b].name));
    });
    return indices.map((i) => filteredGroups[i]);
  }, [filteredGroups, brands, isAr]);

  const stats = useMemo(() => {
    const totalStock = sortedGroups.reduce((s, r) => s + r.totalStock, 0);
    const totalValue = sortedGroups.reduce(
      (s, r) => s + r.variants.reduce((a, v) => a + v.price * v.stock, 0),
      0,
    );
    return {
      products: sortedGroups.length,
      totalStock,
      totalValue,
      outOfStock: sortedGroups.filter((r) => r.totalStock === 0).length,
      lowStock: sortedGroups.filter((r) => r.totalStock > 0 && r.totalStock < 10).length,
    };
  }, [sortedGroups]);

  // ── Export handlers ─────────────────────────────────────────────────────────
  // CRITICAL WEB NOTE: expo-print's `printToFileAsync({html})` on web is
  // backed by `window.print()` which IGNORES the html argument and prints
  // the currently-visible page (i.e. the modal itself!). To actually
  // produce a PDF of the report HTML on web, we open a new window, write
  // the report HTML into it, then trigger print on that window. On native
  // we keep the original expo-print → expo-sharing flow.
  const handlePdf = useCallback(async () => {
    if (working) return;
    if (sortedGroups.length === 0) return;
    setWorking('pdf');
    try {
      const cfg: ReportConfig = {
        showModels, showFitments, showGrandTotal,
        showProductType, showStockIndicator, showSummaryBar,
      };
      const html = buildPdfHTML(sortedGroups, brands, carModels, cfg, isAr);

      if (Platform.OS === 'web') {
        // Web: render the report into a fresh popup window so window.print()
        // captures the report HTML, not the modal underneath.
        const w = (window as any).open('', '_blank');
        if (!w) {
          Alert.alert(
            isAr ? 'تم حظر النافذة المنبثقة' : 'Popup blocked',
            isAr
              ? 'يرجى السماح بالنوافذ المنبثقة لطباعة التقرير'
              : 'Please allow pop-ups to print the report.',
          );
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        // Wait for fonts/images to settle, then trigger the print dialog.
        // The new window stays open so the user can re-print or save.
        const doPrint = () => {
          try { w.focus(); w.print(); } catch { /* user closed window */ }
        };
        if (w.document.readyState === 'complete') setTimeout(doPrint, 400);
        else w.addEventListener('load', () => setTimeout(doPrint, 200));
        onClose();
        return;
      }

      // Native: expo-print works correctly with the html argument.
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: isAr ? 'تقرير المخزون' : 'Inventory Report',
          UTI: 'com.adobe.pdf',
        });
      }
      onClose();
    } catch (err: any) {
      Alert.alert(
        isAr ? 'تعذر إنشاء التقرير' : 'Could not create report',
        String(err?.message || err),
      );
    } finally {
      setWorking(null);
    }
  }, [working, sortedGroups, brands, carModels, showModels, showFitments, showGrandTotal, showProductType, showStockIndicator, isAr, onClose]);

  const handleExcel = useCallback(async () => {
    if (working) return;
    if (sortedGroups.length === 0) return;
    setWorking('excel');
    try {
      const cfg: ReportConfig = {
        showModels, showFitments, showGrandTotal,
        showProductType, showStockIndicator, showSummaryBar,
      };
      const { aoa, merges, cols, sheetName } = buildExcelAOA(sortedGroups, brands, carModels, cfg, isAr);

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(sheetName);
      // Column widths first so addRows respects them. ExcelJS uses
      // `width` (in character units) which matches xlsx's `wch`.
      ws.columns = cols.map((c) => ({ width: c.wch }));
      // Push every row in one shot — `aoa` already contains the header
      // row at index 0 followed by data rows (and the optional totals
      // row), matching the previous xlsx layout.
      ws.addRows(aoa);
      // Translate 0-indexed merge ranges to ExcelJS's 1-indexed
      // mergeCells(startRow, startCol, endRow, endCol) call.
      merges.forEach((m) => {
        ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
      });

      const ts = Date.now();
      const fileName = `inventory-${ts}.xlsx`;

      // ExcelJS returns a Node Buffer in Node, an ArrayBuffer in the
      // browser, and a Uint8Array-ish object in React Native. Both
      // paths below normalize the result before consuming it.
      const wbBuffer = await wb.xlsx.writeBuffer();

      if (Platform.OS === 'web') {
        // Web: build a Blob and trigger a browser download — expo-sharing is
        // a no-op on web and FileSystem.cacheDirectory writes don't surface
        // to the user.
        const blob = new Blob([wbBuffer as ArrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        onClose();
        return;
      }

      // Native: write base64 to cache then share via system sheet.
      const wbout: string = bufferToBase64(wbBuffer as ArrayBuffer);
      const uri = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(uri, wbout, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: isAr ? 'تقرير المخزون' : 'Inventory Report',
          UTI: 'org.openxmlformats.spreadsheetml.sheet',
        });
      } else {
        Alert.alert(
          isAr ? 'تم الحفظ' : 'Saved',
          isAr ? `تم حفظ التقرير في:\n${uri}` : `Report saved to:\n${uri}`,
        );
      }
      onClose();
    } catch (err: any) {
      Alert.alert(
        isAr ? 'تعذر إنشاء التقرير' : 'Could not create report',
        String(err?.message || err),
      );
    } finally {
      setWorking(null);
    }
  }, [working, sortedGroups, brands, carModels, showModels, showFitments, showGrandTotal, showProductType, showStockIndicator, isAr, onClose]);

  // ── Stock filter options ────────────────────────────────────────────────────
  const stockOptions: { id: ReportStockFilter; label: string; icon: string; color: string }[] = useMemo(
    () => isAr
      ? [
          { id: 'all', label: 'الكل', icon: 'apps-outline', color: '#6366F1' },
          { id: 'in_stock', label: 'المتوفر فقط', icon: 'checkmark-circle-outline', color: '#10B981' },
          { id: 'low_only', label: 'المخزون المنخفض فقط', icon: 'warning-outline', color: '#F59E0B' },
          { id: 'out_only', label: 'الذي نفد فقط', icon: 'close-circle-outline', color: '#EF4444' },
          { id: 'exclude_out', label: 'تجنب الذي نفد', icon: 'eye-off-outline', color: '#0EA5E9' },
          { id: 'exclude_low_and_out', label: 'تجنب المنخفض والذي نفد', icon: 'shield-checkmark-outline', color: '#8B5CF6' },
        ]
      : [
          { id: 'all', label: 'All', icon: 'apps-outline', color: '#6366F1' },
          { id: 'in_stock', label: 'In stock only', icon: 'checkmark-circle-outline', color: '#10B981' },
          { id: 'low_only', label: 'Low stock only', icon: 'warning-outline', color: '#F59E0B' },
          { id: 'out_only', label: 'Out of stock only', icon: 'close-circle-outline', color: '#EF4444' },
          { id: 'exclude_out', label: 'Exclude out of stock', icon: 'eye-off-outline', color: '#0EA5E9' },
          { id: 'exclude_low_and_out', label: 'Exclude low & out', icon: 'shield-checkmark-outline', color: '#8B5CF6' },
        ],
    [isAr],
  );

  // Derive fuel-type options from the actual `carModels` data so the modal
  // never shows fuel types that don't exist in inventory (e.g. selecting
  // 'diesel' when no model in the DB carries that fuel type would always
  // return zero results). Counts are surfaced on each chip so the user can
  // see how many models back each option.
  // Product-type filter options. Each entry carries an Ionicon name + accent
  // color so the modal row renders as a polished, futuristic 2-column grid
  // (mirrors the existing Stock-Status grid for visual consistency). A live
  // count is computed from the unfiltered product list so the owner can see
  // how many SKUs sit in each bucket before clicking.
  const productTypeOptions: {
    id: ProductTypeKey; label: string; icon: string; color: string; count: number;
  }[] = useMemo(() => {
    const counts: Record<ProductTypeKey, number> = { regular: 0, tire: 0, accessory: 0, exterior: 0 };
    for (const p of products) counts[productTypeKey(p?.product_type)]++;
    const order: ProductTypeKey[] = ['regular', 'tire', 'accessory', 'exterior'];
    return order.map((id) => ({
      id,
      label: (isAr ? PRODUCT_TYPE_LABELS_AR : PRODUCT_TYPE_LABELS_EN)[id],
      icon: PRODUCT_TYPE_ICONS[id],
      color: PRODUCT_TYPE_COLORS[id],
      count: counts[id],
    }));
  }, [products, isAr]);

  const fuelOptions: { id: FuelType; label: string; count: number }[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of carModels) {
      const raw = String(m?.fuel_type ?? '').trim().toLowerCase();
      if (!raw) continue;
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, label: fuelLabelOf(id, isAr), count }));
  }, [carModels, isAr]);

  const resetFilters = useCallback(() => {
    setSelBrands(new Set());
    setSelCategories(new Set());
    setSelCarModels(new Set());
    setSelFuelTypes(new Set());
    setSelProductTypes(new Set());
    setStockFilter('all');
  }, []);

  const activeFilterCount =
    selBrands.size + selCategories.size + selCarModels.size + selFuelTypes.size + selProductTypes.size + (stockFilter !== 'all' ? 1 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={working ? undefined : onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>

          {/* Header */}
          <View style={styles.cardHeader}>
            <View style={styles.iconBubble}>
              <Ionicons name="document-text" size={22} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {isAr ? 'تقرير المخزون الاحترافي' : 'Pro Inventory Report'}
              </Text>
              <Text style={styles.subtitle}>
                {isAr
                  ? `${stats.products} منتج · قيمة ${stats.totalValue.toLocaleString()} ج.م`
                  : `${stats.products} products · value ${stats.totalValue.toLocaleString()} EGP`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={working !== null}
              style={styles.closeBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Quick stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats.products}</Text>
              <Text style={styles.statLabel}>{isAr ? 'منتجات' : 'Products'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#10B981' }]}>{stats.totalStock}</Text>
              <Text style={styles.statLabel}>{isAr ? 'المخزون' : 'Stock'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#F59E0B' }]}>{stats.lowStock}</Text>
              <Text style={styles.statLabel}>{isAr ? 'منخفض' : 'Low'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#EF4444' }]}>{stats.outOfStock}</Text>
              <Text style={styles.statLabel}>{isAr ? 'نفد' : 'Out'}</Text>
            </View>
          </View>

          {/* Scrollable composer */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Optional columns ───────────────────────────────────────── */}
            <Section
              icon="grid-outline"
              title={isAr ? 'أعمدة التقرير' : 'Report Columns'}
              hint={isAr ? 'الأعمدة الأساسية مفعّلة دائماً' : 'Required columns always shown'}
            >
              <RequiredColsRow isAr={isAr} />
              <ToggleRow
                label={isAr ? 'المطاعم المتوافقة' : 'Compatible restaurants'}
                value={showModels}
                onValueChange={setShowModels}
              />
              <ToggleRow
                label={isAr ? 'مؤشرات التوافق (مع الأسعار)' : 'Fitment indicators (with prices)'}
                value={showFitments}
                onValueChange={setShowFitments}
              />
              <ToggleRow
                label={isAr ? 'إظهار الإجمالي الكلي للسعر' : 'Show grand total of prices'}
                value={showGrandTotal}
                onValueChange={setShowGrandTotal}
              />
              {/* New: dedicated "Product Type" column with smart row-merging.
                  Default ON so the operator immediately sees the bucket of
                  every SKU; can be turned off when the report is meant to
                  emphasise brand grouping only. */}
              <ToggleRow
                label={isAr ? 'إظهار عمود نوع المنتج' : 'Show product type column'}
                value={showProductType}
                onValueChange={setShowProductType}
              />
              {/* New: gate the small "×N" stock badge that appears under each
                  product name (e.g. "×3"). Some operators print the report
                  for customers and prefer a cleaner look without the badge. */}
              <ToggleRow
                label={isAr ? 'إظهار مؤشر عدد القطع تحت اسم المنتج' : 'Show ×N stock badge under product name'}
                value={showStockIndicator}
                onValueChange={setShowStockIndicator}
              />
              {/* New: gate the top stats summary bar (totalProducts, totalStock,
                  totalValue, outOfStock, lowStock). Toggle OFF for a leaner
                  report that goes straight from the header to the table. */}
              <ToggleRow
                label={isAr ? 'إظهار شريط الإحصائيات في الأعلى' : 'Show top stats summary bar'}
                value={showSummaryBar}
                onValueChange={setShowSummaryBar}
              />
            </Section>

            {/* ── Stock filter ──────────────────────────────────────────── */}
            <Section
              icon="layers-outline"
              title={isAr ? 'حالة المخزون' : 'Stock Status'}
              hint={isAr ? 'حدد المنتجات المراد طباعتها' : 'Choose which products to include'}
            >
              <View style={styles.stockGrid}>
                {stockOptions.map((opt) => {
                  const sel = stockFilter === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setStockFilter(opt.id)}
                      style={[
                        styles.stockOption,
                        sel && { borderColor: opt.color, backgroundColor: `${opt.color}1A` },
                      ]}
                    >
                      <Ionicons name={opt.icon as any} size={16} color={sel ? opt.color : '#94A3B8'} />
                      <Text
                        numberOfLines={1}
                        style={[styles.stockOptionText, sel && { color: opt.color, fontWeight: '800' }]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* ── Product type filter (regular / tire / accessory / exterior) ──
                Mirrors the Stock Status grid (2-column polished tiles with
                Ionicon + accent color + live count). NULL product_type rolls
                up into "regular" so legacy SKUs are not orphaned. */}
            <Section
              icon="apps-outline"
              title={isAr ? 'نوع المنتج' : 'Product Type'}
              hint={
                selProductTypes.size > 0
                  ? (isAr
                      ? `${selProductTypes.size} محدد`
                      : `${selProductTypes.size} selected`)
                  : (isAr ? 'حدد الأنواع المراد تضمينها' : 'Choose types to include')
              }
            >
              <View style={styles.stockGrid}>
                {productTypeOptions.map((opt) => {
                  const sel = selProductTypes.has(opt.id);
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => toggleSet(setSelProductTypes)(opt.id)}
                      style={[
                        styles.stockOption,
                        sel && { borderColor: opt.color, backgroundColor: `${opt.color}1A` },
                      ]}
                    >
                      <Ionicons name={opt.icon as any} size={16} color={sel ? opt.color : '#94A3B8'} />
                      <Text
                        numberOfLines={1}
                        style={[styles.stockOptionText, sel && { color: opt.color, fontWeight: '800' }]}
                      >
                        {opt.label}
                        {opt.count > 0 ? `  ·  ${opt.count}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            {/* ── Brand filter (with quick search) ──────────────────────── */}
            {brands.length > 0 && (
              <CollapsibleSearchableSection
                icon="ribbon-outline"
                title={isAr ? 'ماركات المنتجات' : 'Product Brands'}
                items={brands}
                labelOf={(b: any) => isAr ? (b.name_ar || b.name || '') : (b.name || b.name_ar || '')}
                selected={selBrands}
                onToggle={(id) => toggleSet(setSelBrands)(id)}
                isAr={isAr}
              />
            )}

            {/* ── Category filter (with quick search) ───────────────────── */}
            {categories.length > 0 && (
              <CollapsibleSearchableSection
                icon="pricetags-outline"
                title={isAr ? 'الفئات' : 'Categories'}
                items={categories}
                labelOf={(c: any) => isAr ? (c.name_ar || c.name || '') : (c.name || c.name_ar || '')}
                selected={selCategories}
                onToggle={(id) => toggleSet(setSelCategories)(id)}
                isAr={isAr}
              />
            )}

            {/* ── Car model filter (with quick search) ──────────────────── */}
            {carModels.length > 0 && (
              <CollapsibleSearchableSection
                icon="restaurant-outline"
                title={isAr ? 'المطاعم' : 'Restaurants'}
                items={carModels}
                labelOf={(m: any) => isAr ? (m.name_ar || m.name || '') : (m.name || m.name_ar || '')}
                // Sub-label: render the year range (e.g. "2018 - 2022") below
                // each model name. Helps the operator pick the right
                // generation when the same nameplate spans years.
                subLabelOf={(m: any) => formatYearRange(m, isAr)}
                selected={selCarModels}
                onToggle={(id) => toggleSet(setSelCarModels)(id)}
                isAr={isAr}
              />
            )}

            {/* ── Fuel type filter (only types actually present in DB) ──── */}
            {fuelOptions.length > 0 && (
              <CollapsibleFilterSection
                icon="flash-outline"
                title={isAr ? 'أنواع الوقود' : 'Fuel Types'}
                count={selFuelTypes.size}
              >
                <View style={styles.chipWrap}>
                  {fuelOptions.map((f) => (
                    <FilterChip
                      key={f.id}
                      label={f.label}
                      count={f.count}
                      selected={selFuelTypes.has(f.id)}
                      onPress={() => toggleSet(setSelFuelTypes)(f.id)}
                    />
                  ))}
                </View>
              </CollapsibleFilterSection>
            )}

            {/* ── Reset filters ─────────────────────────────────────────── */}
            {activeFilterCount > 0 && (
              <Pressable onPress={resetFilters} style={styles.resetBtn}>
                <Ionicons name="refresh-outline" size={14} color="#94A3B8" />
                <Text style={styles.resetText}>
                  {isAr
                    ? `إعادة ضبط الفلاتر (${activeFilterCount})`
                    : `Reset filters (${activeFilterCount})`}
                </Text>
              </Pressable>
            )}
          </ScrollView>

          {/* ── Action buttons ──────────────────────────────────────────── */}
          <View style={styles.actionsBar}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.pdfBtn]}
              onPress={handlePdf}
              disabled={working !== null || stats.products === 0}
              activeOpacity={0.85}
            >
              {working === 'pdf' ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="print" size={18} color="#FFF" />
                  <Text style={styles.actionTitle}>{isAr ? 'طباعة / PDF' : 'Print / PDF'}</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.excelBtn]}
              onPress={handleExcel}
              disabled={working !== null || stats.products === 0}
              activeOpacity={0.85}
            >
              {working === 'excel' ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="grid" size={18} color="#FFF" />
                  <Text style={styles.actionTitle}>{isAr ? 'تحميل Excel' : 'Excel'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {stats.products === 0 ? (
            <Text style={styles.emptyHint}>
              {isAr
                ? 'لا توجد منتجات تطابق الفلاتر الحالية'
                : 'No products match the current filters'}
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

// ─── Section primitive ───────────────────────────────────────────────────────
const Section: React.FC<{
  icon: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ icon, title, hint, children }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Ionicons name={icon as any} size={15} color={NEON_NIGHT_THEME.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

// Collapsible variant — long lists (brands, models) stay collapsed by default
// so the modal stays scannable. Tap the header to reveal/hide.
const CollapsibleFilterSection: React.FC<{
  icon: string;
  title: string;
  count: number;
  children: React.ReactNode;
}> = ({ icon, title, count, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.sectionHeaderTouchable}>
        <Ionicons name={icon as any} size={15} color={NEON_NIGHT_THEME.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {count > 0 && (
          <View style={styles.countBubble}>
            <Text style={styles.countBubbleText}>{count}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
};

// Searchable collapsible variant — accepts a list of items, a label resolver,
// and a selection map. Renders a search input above the chip wrap and filters
// chips in real time as the user types. Used for the long Brand / Category /
// Car-Model rows in the report composer so the owner can quickly narrow a
// long list (e.g. dozens of car models) instead of scrolling endlessly.
type SearchableItem = { id: string };
const CollapsibleSearchableSection: React.FC<{
  icon: string;
  title: string;
  items: any[];
  labelOf: (item: any) => string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  isAr: boolean;
  // Optional: secondary line rendered under each chip's primary label.
  // Used by the Car-Models row to show "year_start - year_end" beneath the
  // model name without polluting the primary label or the search match.
  subLabelOf?: (item: any) => string | undefined;
}> = ({ icon, title, items, labelOf, selected, onToggle, isAr, subLabelOf }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it: any) => labelOf(it).toLowerCase().includes(q));
  }, [items, query, labelOf]);
  return (
    <View style={styles.section}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.sectionHeaderTouchable}>
        <Ionicons name={icon as any} size={15} color={NEON_NIGHT_THEME.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {selected.size > 0 && (
          <View style={styles.countBubble}>
            <Text style={styles.countBubbleText}>{selected.size}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <Text style={styles.itemsHint}>
          {isAr ? `${items.length} عنصر` : `${items.length} items`}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
      </Pressable>
      {open ? (
        <View style={styles.sectionBody}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={14} color="#94A3B8" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={isAr ? 'بحث سريع...' : 'Quick search...'}
              placeholderTextColor="#94A3B8"
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color="#94A3B8" />
              </Pressable>
            )}
          </View>
          {filtered.length === 0 ? (
            <Text style={styles.searchEmpty}>
              {isAr ? 'لا نتائج تطابق البحث' : 'No matches found'}
            </Text>
          ) : (
            <View style={styles.chipWrap}>
              {filtered.map((it: any) => (
                <FilterChip
                  key={it.id}
                  label={labelOf(it)}
                  subLabel={subLabelOf?.(it)}
                  selected={selected.has(it.id)}
                  onPress={() => onToggle(it.id)}
                />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
};

const ToggleRow: React.FC<{
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}> = ({ label, value, onValueChange }) => (
  <View style={styles.toggleRow}>
    <Text style={styles.toggleLabel}>{label}</Text>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: 'rgba(255,255,255,0.15)', true: NEON_NIGHT_THEME.primary }}
      thumbColor={value ? '#FFF' : '#CBD5E1'}
    />
  </View>
);

const RequiredColsRow: React.FC<{ isAr: boolean }> = ({ isAr }) => (
  <View style={styles.requiredColsRow}>
    {[
      isAr ? 'مسلسل' : '#',
      isAr ? 'اسم المنتج' : 'Name',
      isAr ? 'الماركة وبلد المنشأ' : 'Brand & Country',
      isAr ? 'رقم المنتج' : 'SKU',
      isAr ? 'السعر' : 'Price',
    ].map((label) => (
      <View key={label} style={styles.requiredCol}>
        <Ionicons name="lock-closed" size={9} color="#10B981" />
        <Text style={styles.requiredColText}>{label}</Text>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    backgroundColor: '#0F172A',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: NEON_NIGHT_THEME.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: '#F8FAFC', fontSize: 17, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  statValue: { color: '#F8FAFC', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#94A3B8', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },

  scroll: { flexGrow: 0 },
  scrollContent: { gap: 12, paddingBottom: 4 },

  section: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(99,102,241,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    flexWrap: 'wrap',
  },
  sectionHeaderTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(99,102,241,0.06)',
  },
  sectionTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  sectionHint: { color: '#94A3B8', fontSize: 10, fontStyle: 'italic' },
  sectionBody: { padding: 10, gap: 8 },

  countBubble: {
    backgroundColor: NEON_NIGHT_THEME.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  countBubbleText: { color: '#FFF', fontSize: 10, fontWeight: '800' },

  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  toggleLabel: { color: '#E2E8F0', fontSize: 13, flex: 1, marginRight: 10 },

  requiredColsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  requiredCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.30)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  requiredColText: { color: '#10B981', fontSize: 10, fontWeight: '700' },

  stockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stockOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    flexBasis: '48%',
    flexGrow: 1,
  },
  stockOptionText: { color: '#CBD5E1', fontSize: 11, fontWeight: '600', flex: 1 },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemsHint: { color: '#94A3B8', fontSize: 10, fontWeight: '600', marginRight: 6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'web' ? 6 : 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 12,
    paddingVertical: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  searchEmpty: {
    color: '#64748B',
    fontSize: 11,
    fontStyle: 'italic',
    paddingVertical: 6,
    textAlign: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    maxWidth: '100%',
  },
  chipText: { color: '#E2E8F0', fontSize: 11, fontWeight: '600' },
  // Two-line chip layout (used when a `subLabel` is supplied — e.g. car-model
  // chips that show the year range under the model name).
  chipColumn: { flexDirection: 'column', alignItems: 'flex-start', gap: 1 },
  chipSubText: { color: 'rgba(226,232,240,0.55)', fontSize: 9, fontWeight: '600', letterSpacing: 0.2 },
  chipCount: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  chipCountText: { color: '#94A3B8', fontSize: 9, fontWeight: '800' },

  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  resetText: { color: '#94A3B8', fontSize: 11, fontWeight: '600' },

  actionsBar: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    minHeight: 48,
  },
  pdfBtn: { backgroundColor: NEON_NIGHT_THEME.primary },
  excelBtn: { backgroundColor: '#10B981' },
  actionTitle: { color: '#FFF', fontSize: 14, fontWeight: '800' },

  emptyHint: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
});

export default ReportComposerModal;

/**
 * Admin Order Detail Page - Complete Professional Redesign 2026
 * - Fixed status update (same approach as useOrderOperations)
 * - Fixed price fields (unit_price, not final_unit_price)
 * - Modern invoice-style UI with bundle offer support
 * - Print + Word export functionality
 * - Product/Bundle navigation on tap
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, TextInput, Alert, Modal,
  Platform, Pressable, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/hooks/useTheme';
import { useTranslation } from '../../../src/hooks/useTranslation';
import { Header } from '../../../src/components/Header';
import api from '../../../src/services/api';
import { useIsOwner, useCanAccessAdminPanel } from '../../../src/store/appStore';
import { useConfirmModal } from '../../../src/components/ConfirmModal';
import type { Order, RichOrderItem } from '../../../src/hooks/shopping/types';

const SHIPPING_COST = 50;

const STATUS_CONFIG: Record<string, { label: string; labelAr: string; color: string; icon: string; bg: string }> = {
  pending:          { label: 'Pending',         labelAr: 'قيد الانتظار',  color: '#F59E0B', bg: 'rgba(245,158,11,0.12)',  icon: 'time-outline' },
  confirmed:        { label: 'Confirmed',        labelAr: 'مؤكد',          color: '#6366F1', bg: 'rgba(99,102,241,0.12)',  icon: 'checkmark-done-outline' },
  preparing:        { label: 'Preparing',        labelAr: 'جاري التحضير',  color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)',  icon: 'construct-outline' },
  ready:            { label: 'Ready',            labelAr: 'جاهز',          color: '#06B6D4', bg: 'rgba(6,182,212,0.12)',   icon: 'checkmark-circle-outline' },
  shipped:          { label: 'Shipped',          labelAr: 'تم الشحن',      color: '#3B82F6', bg: 'rgba(59,130,246,0.12)',  icon: 'cube-outline' },
  out_for_delivery: { label: 'Out for Delivery', labelAr: 'في الطريق',     color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)',  icon: 'bicycle-outline' },
  delivered:        { label: 'Delivered',        labelAr: 'تم التوصيل',    color: '#10B981', bg: 'rgba(16,185,129,0.12)',  icon: 'checkmark-circle' },
  cancelled:        { label: 'Cancelled',        labelAr: 'ملغي',          color: '#EF4444', bg: 'rgba(239,68,68,0.12)',   icon: 'close-circle-outline' },
};

const STATUS_FLOW = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'out_for_delivery', 'delivered'];

// ─── SKU chip order for ordering ──────────────────────────────────────────
const CHIP_IND_ORDER = ['STD', '010', '020', '030', '040'];
function sortOrderIndicators(arr: string[]): string[] {
  return [...arr].sort((a, b) => {
    const ai = CHIP_IND_ORDER.indexOf(a);
    const bi = CHIP_IND_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// Group order items by SKU (or product_id). Bundle items pass through as single-entry groups.
function groupOrderItemsBySku(items: RichOrderItem[]): Array<{ groupKey: string; entries: RichOrderItem[] }> {
  const map = new Map<string, RichOrderItem[]>();
  const order: string[] = [];
  for (const item of items) {
    if (item?.bundle_group_id) {
      const k = `bundle:${item.bundle_group_id}:${item.product_id}`;
      if (!map.has(k)) { map.set(k, []); order.push(k); }
      map.get(k)!.push(item);
      continue;
    }
    const sku = String(item?.sku || '').trim().toUpperCase();
    const key = sku ? `sku:${sku}` : `pid:${item?.product_id || item?.id || Math.random()}`;
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key)!.push(item);
  }
  return order.map(key => ({ groupKey: key, entries: map.get(key)! }));
}

// ─── Helper to generate print/Word HTML content — Professional Edition ────
// Escape HTML special chars in any string interpolated into the invoice HTML
// to prevent stored-XSS via product names, customer fields, addresses, etc.
const esc = (v: any): string => {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

function buildOrderHTML(order: Order, language: string): string {
  const isAr = language === 'ar';
  const items = Array.isArray(order.items) ? order.items : [];
  const shipping = parseFloat(String(order.shipping_cost || SHIPPING_COST)) || SHIPPING_COST;
  const discount = parseFloat(String(order.discount_amount || order.discount || 0)) || 0;
  const total = parseFloat(String(order.total_amount || order.total || 0)) || 0;

  const statusLabel = STATUS_CONFIG[order.status]?.[isAr ? 'labelAr' : 'label'] || order.status;
  const statusColor = STATUS_CONFIG[order.status]?.color || '#6B7280';

  const formatDate = (d: string) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  // Group items by SKU for deduplicated invoice rows
  const groups = groupOrderItemsBySku(items);
  let subtotal = 0;

  const groupRows = groups.map(({ entries }) => {
    const head = entries.find(e => String(e.fitment_indicator || 'STD').toUpperCase() === 'STD') ?? entries[0];
    const itemName = isAr ? (head.name_ar || head.name || '') : (head.name || head.name_ar || '');
    const sku = head.sku || '';
    const isBundle = !!head.bundle_group_id;

    // Sort fitments
    const indOrder = sortOrderIndicators(entries.map((e: RichOrderItem) => String(e.fitment_indicator || 'STD').toUpperCase()));
    const sortedEntries = indOrder.map(ind => entries.find((e: RichOrderItem) => String(e.fitment_indicator || 'STD').toUpperCase() === ind)).filter(Boolean) as RichOrderItem[];

    // Compute per-fitment final prices first so we can decide layout & totals.
    let groupSubtotal = 0;
    let groupQty = 0;
    const fitmentChips = sortedEntries.map((entry) => {
      const ind = String(entry.fitment_indicator || 'STD').toUpperCase();
      const origPrice = parseFloat(String(entry.original_unit_price || entry.unit_price || 0)) || 0;
      const bundleDiscPct = parseFloat(String(entry.bundle_discount_percentage || 0)) || 0;
      let finalPrice = parseFloat(String(entry.unit_price || 0)) || 0;
      if (bundleDiscPct > 0 && entry.bundle_group_id && origPrice > 0 && Math.abs(finalPrice - origPrice) < 0.01) {
        finalPrice = origPrice * (1 - bundleDiscPct / 100);
      }
      const qty = entry.quantity || 1;
      const lineTotal = finalPrice * qty;
      groupSubtotal += lineTotal;
      groupQty += qty;
      subtotal += lineTotal;
      const hasDisc = origPrice > 0 && origPrice > finalPrice + 0.01;
      const discPct = hasDisc ? Math.round((1 - finalPrice / origPrice) * 100) : (bundleDiscPct > 0 ? bundleDiscPct : 0);
      return { ind, qty, finalPrice, origPrice, hasDisc, discPct, lineTotal };
    });
    const multipleEntries = fitmentChips.length > 1;

    // Render all fitments as a single horizontal pill row inside one cell —
    // each pill packs indicator + qty + price + (optional strikethrough) so
    // multi-variant products consume one logical row instead of N stacked
    // rows. Single-variant products show the same compact pill layout for
    // visual consistency.
    const pillsHtml = fitmentChips.map((c) => {
      const priceColor = c.hasDisc || c.discPct > 0 ? '#10b981' : '#0f172a';
      return `
        <span class="ft-pill">
          ${multipleEntries ? `<span class="ft-ind">${c.ind}</span>` : ''}
          <span class="ft-qty">×${c.qty}</span>
          ${c.hasDisc ? `<span class="ft-orig">${c.origPrice.toFixed(2)}</span>` : ''}
          <span class="ft-price" style="color:${priceColor};">${c.finalPrice.toFixed(2)}</span>
          <span class="ft-cur">ج.م</span>
          ${c.discPct > 0 ? `<span class="ft-disc">-${c.discPct}%</span>` : ''}
        </span>`;
    }).join('');

    const productRow = `
      <tr class="prod-row">
        <td class="prod-name-cell">
          <div class="prod-name">${esc(itemName)}</div>
          <div class="prod-meta">
            ${sku ? `<span class="sku-pill">SKU: ${esc(sku)}</span>` : ''}
            ${isBundle ? `<span class="bundle-pill">🎁 ${isAr ? 'عرض مجمع' : 'Bundle'}</span>` : ''}
          </div>
        </td>
        <td class="prod-pills-cell">
          <div class="ft-row">${pillsHtml}</div>
        </td>
        <td class="prod-qty-cell">${groupQty}</td>
        <td class="prod-total-cell">${groupSubtotal.toFixed(2)} <span class="cur-sm">ج.م</span></td>
      </tr>`;

    return productRow;
  }).join('');

  const custName = order.user_name || [order.first_name, order.last_name].filter(Boolean).join(' ') || '-';
  const addressParts = [order.street_address, order.city, order.state, order.country].filter(Boolean).join(', ') || '-';
  const payment = order.payment_method === 'cash_on_delivery' ? (isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery') : (order.payment_method || '-');
  const itemCount = items.length;
  const generatedAt = new Date().toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!DOCTYPE html>
<html dir="${isAr ? 'rtl' : 'ltr'}" lang="${isAr ? 'ar' : 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isAr ? 'فاتورة' : 'Invoice'} — ${esc(order.order_number)}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:${isAr ? "'Tajawal'" : "'Inter'"},sans-serif;background:#eef2ff;color:#1e293b;direction:${isAr ? 'rtl' : 'ltr'};-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page{max-width:820px;margin:32px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 48px rgba(99,102,241,0.12);}
  /* HEADER */
  .inv-header{background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#312e81 100%);padding:36px 44px;position:relative;overflow:hidden;}
  .inv-header::before{content:'';position:absolute;top:-60px;${isAr ? 'left' : 'right'}:-60px;width:240px;height:240px;background:rgba(99,102,241,0.18);border-radius:50%;}
  .inv-header::after{content:'';position:absolute;bottom:-40px;${isAr ? 'right' : 'left'}:-20px;width:160px;height:160px;background:rgba(139,92,246,0.12);border-radius:50%;}
  .co-name{font-size:26px;font-weight:800;color:#fff;letter-spacing:0.5px;position:relative;}
  .co-sub{font-size:13px;color:rgba(255,255,255,0.55);margin-top:3px;font-weight:300;position:relative;}
  .co-divider{width:48px;height:3px;background:linear-gradient(90deg,#818cf8,#a78bfa);border-radius:2px;margin:14px 0;position:relative;}
  .meta-row{display:flex;justify-content:space-between;align-items:flex-end;margin-top:20px;flex-wrap:wrap;gap:16px;position:relative;}
  .ord-num{font-size:22px;font-weight:800;color:#fff;letter-spacing:0.5px;}
  .ord-date{font-size:12px;color:rgba(255,255,255,0.6);margin-top:4px;}
  .status-badge{padding:7px 18px;border-radius:30px;font-size:12px;font-weight:800;letter-spacing:0.4px;background:${statusColor}28;color:${statusColor};border:1.5px solid ${statusColor}55;backdrop-filter:blur(4px);}
  /* BAND */
  .kpi-band{display:grid;grid-template-columns:repeat(3,1fr);background:#f8fafc;border-bottom:1px solid #e2e8f0;}
  .kpi{padding:18px 20px;text-align:center;border-${isAr ? 'left' : 'right'}:1px solid #e2e8f0;}
  .kpi:last-child{border:none;}
  .kpi-val{font-size:20px;font-weight:800;color:#1e293b;}
  .kpi-lbl{font-size:11px;color:#94a3b8;margin-top:2px;font-weight:500;letter-spacing:0.4px;text-transform:uppercase;}
  /* BODY */
  .body{padding:36px 44px;}
  .sec-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#94a3b8;margin-bottom:14px;display:flex;align-items:center;gap:8px;}
  .sec-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,#e2e8f0,transparent);}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:32px;}
  .info-box{background:#f8fafc;border-radius:12px;padding:18px;border:1px solid #e2e8f0;}
  .info-box-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:10px;}
  .info-row{margin-bottom:5px;}
  .info-lbl{font-size:11px;color:#94a3b8;}
  .info-val{font-size:13px;font-weight:600;color:#1e293b;}
  /* TABLE — single row per product, fitments rendered inline as horizontal pills */
  table{width:100%;border-collapse:separate;border-spacing:0;margin-bottom:28px;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}
  thead tr{background:linear-gradient(135deg,#f1f5f9,#e8ecf4);}
  th{padding:12px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;font-weight:700;text-align:${isAr ? 'right' : 'left'};}
  th.qty-h,th.tot-h{text-align:center;}
  .prod-row td{padding:14px 12px;border-top:1px solid #eef0f8;vertical-align:middle;}
  .prod-row:first-child td{border-top:none;}
  .prod-row:nth-child(even) td{background:#fcfdff;}
  .prod-name-cell{max-width:240px;}
  .prod-name{font-size:13px;font-weight:800;color:#0f172a;line-height:1.4;margin-bottom:5px;}
  .prod-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
  .sku-pill{font-size:10px;background:#f1f5f9;color:#64748b;padding:3px 9px;border-radius:20px;font-weight:600;letter-spacing:0.4px;}
  .bundle-pill{font-size:10px;background:rgba(16,185,129,0.1);color:#10b981;padding:3px 9px;border-radius:20px;font-weight:700;}
  .prod-pills-cell{padding-${isAr ? 'left' : 'right'}:8px;}
  .ft-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;${isAr ? 'justify-content:flex-end;' : ''}}
  .ft-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:999px;background:linear-gradient(135deg,#eef2ff,#f5f3ff);border:1px solid #c7d2fe;font-size:11px;line-height:1;}
  .ft-ind{font-size:9px;font-weight:800;letter-spacing:0.5px;color:#4f46e5;background:#fff;padding:2px 6px;border-radius:6px;border:1px solid #c7d2fe;}
  .ft-qty{font-weight:700;color:#475569;font-size:10px;}
  .ft-orig{text-decoration:line-through;color:#94a3b8;font-size:9px;}
  .ft-price{font-weight:800;font-size:12px;font-variant-numeric:tabular-nums;}
  .ft-cur{font-size:9px;color:#64748b;font-weight:600;}
  .ft-disc{font-size:9px;font-weight:800;color:#10b981;background:rgba(16,185,129,0.12);padding:2px 5px;border-radius:5px;}
  .prod-qty-cell{text-align:center;font-size:14px;font-weight:800;color:#374151;width:60px;}
  .prod-total-cell{text-align:${isAr ? 'left' : 'right'};font-size:14px;font-weight:800;color:#1e293b;font-variant-numeric:tabular-nums;width:120px;}
  .cur-sm{font-size:10px;color:#64748b;font-weight:600;}
  /* SUMMARY */
  .summary-grid{background:#f8fafc;border-radius:14px;padding:22px;border:1px solid #e2e8f0;margin-bottom:24px;}
  .sum-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:14px;}
  .sum-row.disc{color:#10b981;}
  .sum-row.grand{border-top:2px solid #e2e8f0;margin-top:10px;padding-top:14px;}
  .grand-label{font-size:17px;font-weight:800;color:#1e293b;}
  .grand-val{font-size:22px;font-weight:800;color:#6366f1;}
  /* FOOTER */
  .inv-footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 44px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}
  .footer-brand{font-size:13px;font-weight:700;color:#334155;}
  .footer-meta{font-size:11px;color:#94a3b8;}
  /* WATERMARK */
  .watermark{position:fixed;bottom:40px;${isAr ? 'left' : 'right'}:40px;opacity:0.04;font-size:80px;font-weight:900;color:#6366f1;pointer-events:none;transform:rotate(-20deg);z-index:0;}
  @media print{
    body{background:#fff;}
    .page{box-shadow:none;margin:0;border-radius:0;}
    .watermark{display:none;}
  }
</style>
</head>
<body>
<div class="watermark">INVOICE</div>
<div class="page">

  <div class="inv-header">
    <div class="co-name">مطعم الغزالي</div>
    <div class="co-sub">Al-Ghazaly Dining · Luxury Restaurant</div>
    <div class="co-divider"></div>
    <div class="meta-row">
      <div>
        <div class="ord-num">${esc(order.order_number)}</div>
        <div class="ord-date">${esc(formatDate(order.created_at ?? ''))}</div>
      </div>
      <div class="status-badge">${esc(statusLabel)}</div>
    </div>
  </div>

  <div class="kpi-band">
    <div class="kpi">
      <div class="kpi-val">${itemCount}</div>
      <div class="kpi-lbl">${isAr ? 'منتجات' : 'Items'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val">${subtotal.toFixed(0)} ج.م</div>
      <div class="kpi-lbl">${isAr ? 'قبل الضريبة والشحن' : 'Before Shipping'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-val" style="color:#6366f1;">${total.toFixed(0)} ج.م</div>
      <div class="kpi-lbl">${isAr ? 'الإجمالي النهائي' : 'Grand Total'}</div>
    </div>
  </div>

  <div class="body">

    <div class="sec-title">${isAr ? 'معلومات الطرفين' : 'Party Information'}</div>
    <div class="info-grid">
      <div class="info-box">
        <div class="info-box-title">${isAr ? 'بيانات العميل' : 'Customer'}</div>
        <div class="info-row"><div class="info-lbl">${isAr ? 'الاسم' : 'Name'}</div><div class="info-val">${esc(custName)}</div></div>
        <div class="info-row"><div class="info-lbl">${isAr ? 'الهاتف' : 'Phone'}</div><div class="info-val">${esc(order.phone || '-')}</div></div>
        <div class="info-row"><div class="info-lbl">${isAr ? 'البريد' : 'Email'}</div><div class="info-val">${esc(order.user_email || order.email || '-')}</div></div>
      </div>
      <div class="info-box">
        <div class="info-box-title">${isAr ? 'التوصيل والدفع' : 'Delivery & Payment'}</div>
        <div class="info-row"><div class="info-lbl">${isAr ? 'العنوان' : 'Address'}</div><div class="info-val">${esc(addressParts)}</div></div>
        ${order.delivery_instructions ? `<div class="info-row"><div class="info-lbl">${isAr ? 'تعليمات' : 'Notes'}</div><div class="info-val">${esc(order.delivery_instructions)}</div></div>` : ''}
        <div class="info-row"><div class="info-lbl">${isAr ? 'الدفع' : 'Payment'}</div><div class="info-val">${esc(payment)}</div></div>
      </div>
    </div>

    <div class="sec-title">${isAr ? 'تفاصيل المنتجات' : 'Product Details'}</div>
    <table>
      <thead>
        <tr>
          <th>${isAr ? 'المنتج' : 'Product'}</th>
          <th>${isAr ? 'المؤشرات والأسعار' : 'Fitments & Prices'}</th>
          <th class="qty-h">${isAr ? 'الكمية' : 'Qty'}</th>
          <th class="tot-h">${isAr ? 'الإجمالي' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>${groupRows}</tbody>
    </table>

    <div class="sec-title">${isAr ? 'ملخص الفاتورة' : 'Invoice Summary'}</div>
    <div class="summary-grid">
      <div class="sum-row"><span style="color:#64748b;">${isAr ? 'المجموع الفرعي' : 'Subtotal'}</span><span style="font-weight:600;">${subtotal.toFixed(2)} ج.م</span></div>
      <div class="sum-row"><span style="color:#64748b;">${isAr ? 'رسوم التوصيل' : 'Shipping'}</span><span style="font-weight:600;">${shipping.toFixed(2)} ج.م</span></div>
      ${discount > 0 ? `<div class="sum-row disc"><span>${isAr ? 'خصم خاص' : 'Discount'}</span><span style="font-weight:700;">−${discount.toFixed(2)} ج.م</span></div>` : ''}
      <div class="sum-row grand">
        <span class="grand-label">${isAr ? 'الإجمالي النهائي' : 'Grand Total'}</span>
        <span class="grand-val">${total.toFixed(2)} ج.م</span>
      </div>
    </div>

  </div>

  <div class="inv-footer">
    <div class="footer-brand">مطعم الغزالي · Al-Ghazaly Dining</div>
    <div class="footer-meta">${isAr ? 'صدر بتاريخ' : 'Generated on'}: ${generatedAt}</div>
  </div>

</div>
<script>
  window.addEventListener('load', function() {
    var images = document.images;
    var loaded = 0;
    if (!images.length) return;
    for (var i = 0; i < images.length; i++) {
      if (images[i].complete) { loaded++; }
      else { images[i].addEventListener('load', function() { loaded++; }); }
    }
  });
</script>
</body>
</html>`;
}

// ─── Print handler (web) ──────────────────────────────────────────────────
function printOrder(order: Order, language: string) {
  if (Platform.OS !== 'web') {
    Alert.alert(language === 'ar' ? 'الطباعة' : 'Print', language === 'ar' ? 'الطباعة متاحة على الويب فقط' : 'Printing is available on web only');
    return;
  }
  const html = buildOrderHTML(order, language);
  const w = (window as any).open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  }
}

// ─── Word download handler (web) ──────────────────────────────────────────
function downloadWordOrder(order: Order, language: string) {
  if (Platform.OS !== 'web') {
    Alert.alert(language === 'ar' ? 'تحميل' : 'Download', language === 'ar' ? 'التحميل متاح على الويب فقط' : 'Download is available on web only');
    return;
  }
  const html = buildOrderHTML(order, language);
  // Wrap in Word-compatible XML for .doc format
  const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${order.order_number}</title></head><body>${html}</body></html>`;
  const blob = new Blob([wordDoc], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `order-${order.order_number}.doc`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── StatusUpdateBar ──────────────────────────────────────────────────────
const StatusUpdateBar: React.FC<{
  order: Order;
  language: string;
  isRTL: boolean;
  updatingStatus: string | null;
  onUpdate: (status: string) => void;
  onCancel: () => void;
  colors: any;
}> = ({ order, language, isRTL, updatingStatus, onUpdate, onCancel, colors }) => {
  const currentIdx = STATUS_FLOW.indexOf(order.status);

  return (
    <View style={[sbar.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[sbar.titleRow, isRTL && sbar.rowRev]}>
        <View style={[sbar.titleIcon, { backgroundColor: 'rgba(99,102,241,0.1)' }]}>
          <Ionicons name="sync-outline" size={16} color="#6366F1" />
        </View>
        <Text style={[sbar.title, { color: colors.text }]}>
          {language === 'ar' ? 'تحديث حالة الطلب' : 'Update Order Status'}
        </Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={sbar.buttonsRow}>
        {STATUS_FLOW.filter(s => s !== 'pending').map((status) => {
          const cfg = STATUS_CONFIG[status];
          const isCurrent = order.status === status;
          const isPast = currentIdx > STATUS_FLOW.indexOf(status);
          const isLoading = updatingStatus === status;
          return (
            <TouchableOpacity
              key={status}
              style={[
                sbar.btn,
                {
                  backgroundColor: isCurrent ? cfg.color : isPast ? 'rgba(16,185,129,0.1)' : cfg.bg,
                  borderColor: isCurrent ? cfg.color : isPast ? '#10B981' : `${cfg.color}55`,
                  opacity: isCurrent ? 1 : isPast ? 0.7 : 1,
                },
              ]}
              onPress={() => !isCurrent && !isPast && onUpdate(status)}
              disabled={isCurrent || isPast || updatingStatus !== null}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={isCurrent ? '#FFF' : cfg.color} />
              ) : (
                <>
                  <Ionicons
                    name={(isPast ? 'checkmark-circle' : cfg.icon) as any}
                    size={14}
                    color={isCurrent ? '#FFF' : isPast ? '#10B981' : cfg.color}
                  />
                  <Text style={[sbar.btnText, { color: isCurrent ? '#FFF' : isPast ? '#10B981' : cfg.color }]}>
                    {language === 'ar' ? cfg.labelAr : cfg.label}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {!['shipped', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status) && (
        <TouchableOpacity
          style={[sbar.cancelBtn, { borderColor: '#EF4444' }]}
          onPress={onCancel}
          disabled={updatingStatus !== null}
        >
          {updatingStatus === 'cancelled' ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <>
              <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
              <Text style={sbar.cancelText}>{language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order'}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const sbar = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  rowRev: { flexDirection: 'row-reverse' },
  titleIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  buttonsRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 22, borderWidth: 1.5, minWidth: 90 },
  btnText: { fontSize: 12, fontWeight: '700' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 12, paddingVertical: 11, gap: 8, marginTop: 12 },
  cancelText: { fontSize: 13, fontWeight: '700', color: '#EF4444' },
});

// ─── CustomerInfoCard ─────────────────────────────────────────────────────
const CustomerInfoCard: React.FC<{ order: Order; language: string; isRTL: boolean; colors: any }> = ({ order, language, isRTL, colors }) => {
  const isAr = language === 'ar';
  const name = order.user_name || [order.first_name, order.last_name].filter(Boolean).join(' ') || '-';
  const fields = [
    { icon: 'person-outline', label: isAr ? 'الاسم' : 'Name', value: name },
    { icon: 'call-outline', label: isAr ? 'الهاتف' : 'Phone', value: order.phone || '-' },
    { icon: 'mail-outline', label: isAr ? 'البريد' : 'Email', value: order.user_email || order.email || '-' },
    { icon: 'card-outline', label: isAr ? 'الدفع' : 'Payment', value: order.payment_method === 'cash_on_delivery' ? (isAr ? 'الدفع عند الاستلام' : 'Cash on Delivery') : (order.payment_method || '-') },
  ];
  const hasAddress = !!(order.street_address || order.city);
  const addressParts = [order.street_address, order.city, order.state, order.country].filter(Boolean);

  return (
    <View style={[cust.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[cust.header, isRTL && cust.rev]}>
        <View style={[cust.iconWrap, { backgroundColor: 'rgba(99,102,241,0.1)' }]}>
          <Ionicons name="person" size={18} color="#6366F1" />
        </View>
        <Text style={[cust.sectionTitle, { color: colors.text }]}>
          {isAr ? 'بيانات العميل' : 'Customer Details'}
        </Text>
      </View>
      <View style={cust.grid}>
        {fields.map((f, i) => (
          <View key={i} style={[cust.field, isRTL && cust.rev]}>
            <View style={[cust.fieldIcon, { backgroundColor: colors.surface }]}>
              <Ionicons name={f.icon as any} size={14} color={colors.textSecondary} />
            </View>
            <View style={cust.fieldText}>
              <Text style={[cust.fieldLabel, { color: colors.textSecondary }]}>{f.label}</Text>
              <Text style={[cust.fieldValue, { color: colors.text }]} numberOfLines={1}>{f.value}</Text>
            </View>
          </View>
        ))}
      </View>
      {hasAddress && (
        <View style={[cust.addressBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[cust.row, isRTL && cust.rev]}>
            <Ionicons name="location-outline" size={14} color="#6366F1" />
            <Text style={[cust.addressLabel, { color: colors.textSecondary }]}>
              {isAr ? 'عنوان التوصيل' : 'Delivery Address'}
            </Text>
          </View>
          <Text style={[cust.addressText, { color: colors.text }]}>{addressParts.join(', ')}</Text>
          {order.delivery_instructions ? (
            <Text style={[cust.instructions, { color: colors.textSecondary }]}>
              {isAr ? '📝 ' : '📝 '}{order.delivery_instructions}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
};

const cust = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  rev: { flexDirection: 'row-reverse' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '47%' },
  fieldIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  fieldText: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 13, fontWeight: '600', marginTop: 1 },
  addressBox: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 12, gap: 4 },
  addressLabel: { fontSize: 11, fontWeight: '600' },
  addressText: { fontSize: 13, fontWeight: '500', marginTop: 4 },
  instructions: { fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});

// ─── GroupedOrderCard ─────────────────────────────────────────────────────
// Displays one SKU group as a card. Multiple fitments = chip strip rows.
// Display-only (no qty controls) — mirrors GroupedCartCard layout.
const GroupedOrderCard: React.FC<{
  entries: RichOrderItem[];
  language: string;
  isRTL: boolean;
  colors: any;
  onPressProduct: (productId: string) => void;
  onPressBundle: (offerId: string) => void;
}> = ({ entries, language, isRTL, colors, onPressProduct, onPressBundle }) => {
  const isAr = language === 'ar';
  const head = entries.find(e => String(e.fitment_indicator || 'STD').toUpperCase() === 'STD') ?? entries[0];
  const productName = isAr ? (head.name_ar || head.name || '') : (head.name || head.name_ar || '');
  const sku = head.sku || '';
  const isBundle = !!head.bundle_group_id;

  // Sort entries STD-first
  const indOrder = sortOrderIndicators(entries.map((e: RichOrderItem) => String(e.fitment_indicator || 'STD').toUpperCase()));
  const sorted = indOrder.map(ind => entries.find((e: RichOrderItem) => String(e.fitment_indicator || 'STD').toUpperCase() === ind)).filter(Boolean) as RichOrderItem[];

  const multiVariant = sorted.length > 1;

  // Compute per-entry final prices
  type ChipRow = { entry: RichOrderItem; ind: string; finalPrice: number; origPrice: number; hasDisc: boolean; discPct: number; lineTotal: number; qty: number };
  const chipRows: ChipRow[] = sorted.map(entry => {
    const origP = parseFloat(String(entry.original_unit_price || entry.unit_price || 0)) || 0;
    const bundleD = parseFloat(String(entry.bundle_discount_percentage || 0)) || 0;
    let finP = parseFloat(String(entry.unit_price || 0)) || 0;
    if (bundleD > 0 && entry.bundle_group_id && origP > 0 && Math.abs(finP - origP) < 0.01) finP = origP * (1 - bundleD / 100);
    const hasD = origP > 0 && origP > finP + 0.01;
    const dPct = hasD ? Math.round((1 - finP / origP) * 100) : (bundleD > 0 ? bundleD : 0);
    const qty = entry.quantity || 1;
    return { entry, ind: String(entry.fitment_indicator || 'STD').toUpperCase(), finalPrice: finP, origPrice: origP, hasDisc: hasD, discPct: dPct, lineTotal: finP * qty, qty };
  });

  const cardTotal = chipRows.reduce((s, r) => s + r.lineTotal, 0);
  const cardQty = chipRows.reduce((s, r) => s + r.qty, 0);

  return (
    <View style={[gc.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Top row: image + name/sku */}
      <View style={[gc.topRow, isRTL && gc.rev]}>
        <TouchableOpacity activeOpacity={0.8} onPress={() => { const pid = head.product_id || head.id; if (pid) onPressProduct(pid); }} style={gc.imgWrap}>
          {head.image_url ? (
            <Image source={{ uri: head.image_url }} style={gc.img} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <View style={[gc.imgPlaceholder, { backgroundColor: colors.surface }]}>
              <Ionicons name="cube-outline" size={28} color={colors.textSecondary} />
            </View>
          )}
          {isBundle && (
            <View style={gc.bundleBadgeImg}>
              <Ionicons name="gift" size={9} color="#FFF" />
            </View>
          )}
        </TouchableOpacity>

        <View style={gc.nameCol}>
          <TouchableOpacity activeOpacity={0.7} onPress={() => { const pid = head.product_id || head.id; if (pid) onPressProduct(pid); }}>
            <Text style={[gc.name, { color: colors.text }]} numberOfLines={2}>{productName}</Text>
          </TouchableOpacity>
          <View style={[gc.metaRow, isRTL && gc.rev]}>
            {sku ? (
              <View style={[gc.skuBadge, { backgroundColor: colors.surface }]}>
                <Ionicons name="barcode-outline" size={11} color={colors.textSecondary} />
                <Text style={[gc.skuText, { color: colors.textSecondary }]}>SKU: {sku}</Text>
              </View>
            ) : null}
            {isBundle && (
              <TouchableOpacity onPress={() => { const oid = head.bundle_offer_id || head.bundle_group_id; if (oid) onPressBundle(oid); }} style={gc.bundleBtn} activeOpacity={0.7}>
                <Ionicons name="gift-outline" size={11} color="#10B981" />
                <Text style={gc.bundleTxt}>{isAr ? 'عرض مجمع' : 'Bundle'}</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* Brand badge — server-snapshotted at checkout (orders.items JSON
              carries product_brand_name so admin order view stays readable
              even after the underlying product is renamed/edited). */}
          {head.product_brand_name ? (
            <View style={[gc.brandBadge, { backgroundColor: '#8B5CF615', borderColor: '#8B5CF640' }]}>
              <Ionicons name="ribbon-outline" size={11} color="#8B5CF6" />
              <Text style={[gc.brandText, { color: '#8B5CF6' }]} numberOfLines={1}>
                {head.product_brand_name}
              </Text>
            </View>
          ) : null}
          {/* Compatible restaurants badge — first 3 snapshotted. */}
          {Array.isArray(head.compatible_car_models) && head.compatible_car_models.length > 0 ? (
            <View style={[gc.modelsBadge, { backgroundColor: '#3B82F615' }]}>
              <Ionicons name="restaurant-outline" size={11} color="#3B82F6" />
              <Text style={[gc.modelsText, { color: '#3B82F6' }]} numberOfLines={1}>
                {head.compatible_car_models
                  .slice(0, 3)
                  .map((m: any) => (isAr ? m?.name_ar || m?.name : m?.name || m?.name_ar))
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ) : null}
          {!multiVariant && (
            <View style={[gc.singleQtyRow, isRTL && gc.rev]}>
              <Text style={[gc.qtyLabel, { color: colors.textSecondary }]}>
                {isAr ? `الكمية: ${chipRows[0]?.qty}` : `Qty: ${chipRows[0]?.qty}`}
              </Text>
              {chipRows[0]?.hasDisc && (
                <Text style={gc.origPriceTxt}>{chipRows[0].origPrice.toFixed(2)} ج.م</Text>
              )}
              <Text style={[gc.unitPriceTxt, { color: colors.textSecondary }]}>{chipRows[0]?.finalPrice.toFixed(2)} ج.م</Text>
            </View>
          )}
        </View>

        {/* Right side: total */}
        <View style={[gc.totalsCol, isRTL && { alignItems: 'flex-start' }]}>
          <Text style={[gc.totalLbl, { color: colors.textSecondary }]}>{isAr ? 'الإجمالي' : 'Total'}</Text>
          <Text style={[gc.totalVal, { color: colors.text }]}>{cardTotal.toFixed(2)}</Text>
          <Text style={[gc.totalCur, { color: colors.textSecondary }]}>ج.م</Text>
          {multiVariant && (
            <View style={[gc.qtyCircle, { backgroundColor: 'rgba(99,102,241,0.1)' }]}>
              <Text style={gc.qtyCircleTxt}>{isAr ? `×${cardQty}` : `×${cardQty}`}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Horizontal fitment-pill row — one row per product, pills wrap as needed.
          Each pill compactly packs indicator + qty + final price + (strike +
          discount badge when applicable) so the card height stays minimal even
          for products with 3-4 fitments. Single-fitment products skip the
          indicator chip inside the pill since it's redundant. */}
      {multiVariant && (
        <View style={[gc.chipsSection, { borderTopColor: colors.border }]}>
          <View style={[gc.pillsRow, isRTL && { justifyContent: 'flex-end' }]}>
            {chipRows.map((row, idx) => (
              <View key={`${row.ind}-${idx}`} style={gc.fitPill}>
                <View style={gc.fitIndBox}>
                  <Text style={gc.fitIndTxt}>{row.ind}</Text>
                </View>
                <Text style={gc.fitQtyTxt}>×{row.qty}</Text>
                {row.hasDisc && (
                  <Text style={gc.fitOrigTxt}>{row.origPrice.toFixed(0)}</Text>
                )}
                <Text style={[gc.fitPriceTxt, { color: row.hasDisc || row.discPct > 0 ? '#10B981' : colors.text }]}>
                  {row.finalPrice.toFixed(2)}
                </Text>
                <Text style={gc.fitCurTxt}>ج.م</Text>
                {row.discPct > 0 && (
                  <View style={gc.fitDiscBox}>
                    <Text style={gc.fitDiscTxt}>-{row.discPct}%</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};

const gc = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rev: { flexDirection: 'row-reverse' },
  imgWrap: { position: 'relative', flexShrink: 0 },
  img: { width: 72, height: 72, borderRadius: 10 },
  imgPlaceholder: { width: 72, height: 72, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bundleBadgeImg: { position: 'absolute', top: -3, right: -3, width: 18, height: 18, borderRadius: 9, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  nameCol: { flex: 1, gap: 4 },
  name: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  skuBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  skuText: { fontSize: 10, fontWeight: '600' },
  bundleBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(16,185,129,0.1)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  bundleTxt: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  brandBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, gap: 4, marginTop: 4, maxWidth: '100%' },
  brandText: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
  modelsBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, gap: 4, marginTop: 4, maxWidth: '100%' },
  modelsText: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  singleQtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  qtyLabel: { fontSize: 12 },
  origPriceTxt: { fontSize: 11, color: '#9CA3AF', textDecorationLine: 'line-through' },
  unitPriceTxt: { fontSize: 12, fontWeight: '600' },
  totalsCol: { alignItems: 'flex-end', minWidth: 70, gap: 1 },
  totalLbl: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  totalVal: { fontSize: 18, fontWeight: '800' },
  totalCur: { fontSize: 11, fontWeight: '500' },
  qtyCircle: { marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  qtyCircleTxt: { fontSize: 11, fontWeight: '800', color: '#6366F1' },
  chipsSection: { borderTopWidth: 1, marginTop: 12, paddingTop: 10 },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  fitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(99,102,241,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.25)',
  },
  fitIndBox: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    minWidth: 28,
    alignItems: 'center',
  },
  fitIndTxt: { color: '#4F46E5', fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  fitQtyTxt: { fontSize: 10, fontWeight: '700', color: '#475569' },
  fitOrigTxt: { fontSize: 9, color: '#94A3B8', textDecorationLine: 'line-through' },
  fitPriceTxt: { fontSize: 12, fontWeight: '800' },
  fitCurTxt: { fontSize: 9, color: '#64748B', fontWeight: '600' },
  fitDiscBox: { backgroundColor: 'rgba(16,185,129,0.15)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  fitDiscTxt: { color: '#10B981', fontSize: 9, fontWeight: '800' },
});

// ─── ExportModal ──────────────────────────────────────────────────────────
const ExportModal: React.FC<{
  visible: boolean;
  language: string;
  isRTL: boolean;
  colors: any;
  onClose: () => void;
  onPrint: () => void;
  onWord: () => void;
}> = ({ visible, language, isRTL, colors, onClose, onPrint, onWord }) => {
  const isAr = language === 'ar';
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }).start();
    } else {
      scaleAnim.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={exp.overlay} onPress={onClose}>
        <Animated.View
          style={[exp.sheet, { backgroundColor: colors.card, transform: [{ scale: scaleAnim }] }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[exp.title, { color: colors.text }]}>
            {isAr ? 'تصدير الطلب' : 'Export Order'}
          </Text>
          <Text style={[exp.subtitle, { color: colors.textSecondary }]}>
            {isAr ? 'اختر طريقة التصدير' : 'Choose export method'}
          </Text>
          <View style={[exp.btns, isRTL && exp.revRow]}>
            <TouchableOpacity style={[exp.exportBtn, { backgroundColor: 'rgba(99,102,241,0.1)', borderColor: '#6366F1' }]} onPress={onPrint}>
              <View style={[exp.btnIcon, { backgroundColor: '#6366F1' }]}>
                <Ionicons name="print-outline" size={26} color="#FFF" />
              </View>
              <Text style={[exp.btnLabel, { color: '#6366F1' }]}>{isAr ? 'طباعة' : 'Print'}</Text>
              <Text style={[exp.btnSub, { color: colors.textSecondary }]}>{isAr ? 'طباعة الطلب كاملاً' : 'Print full order'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[exp.exportBtn, { backgroundColor: 'rgba(16,185,129,0.1)', borderColor: '#10B981' }]} onPress={onWord}>
              <View style={[exp.btnIcon, { backgroundColor: '#10B981' }]}>
                <Ionicons name="document-text-outline" size={26} color="#FFF" />
              </View>
              <Text style={[exp.btnLabel, { color: '#10B981' }]}>{isAr ? 'Word' : 'Word'}</Text>
              <Text style={[exp.btnSub, { color: colors.textSecondary }]}>{isAr ? 'تحميل كملف Word' : 'Download as .doc'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[exp.closeBtn, { borderColor: colors.border }]} onPress={onClose}>
            <Text style={[exp.closeTxt, { color: colors.textSecondary }]}>{isAr ? 'إلغاء' : 'Cancel'}</Text>
          </TouchableOpacity>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const exp = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', maxWidth: 360, borderRadius: 24, padding: 24, alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20 },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  subtitle: { fontSize: 13, marginBottom: 20 },
  btns: { flexDirection: 'row', gap: 14, marginBottom: 16 },
  revRow: { flexDirection: 'row-reverse' },
  exportBtn: { flex: 1, alignItems: 'center', borderRadius: 16, borderWidth: 1.5, paddingVertical: 18, paddingHorizontal: 8, gap: 8 },
  btnIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { fontSize: 16, fontWeight: '800' },
  btnSub: { fontSize: 11, textAlign: 'center' },
  closeBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 32 },
  closeTxt: { fontSize: 14, fontWeight: '600' },
});

// ─── Main Component ───────────────────────────────────────────────────────
export default function OrderDetailAdmin() {
  const { colors } = useTheme();
  const { language, isRTL } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams();
  const orderId = Array.isArray(params.id) ? params.id[0] : params.id;
  const isOwner = useIsOwner();
  const isAdmin = useCanAccessAdminPanel();
  const { showConfirm, ConfirmModalNode } = useConfirmModal();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [discountInput, setDiscountInput] = useState('');
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [discountApplied, setDiscountApplied] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const fabScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (orderId) fetchOrder();
  }, [orderId]);

  const fetchOrder = async () => {
    setLoading(true);
    try {
      let response;
      if (isAdmin) {
        response = await api.get(`/orders/admin/${orderId}`);
      } else {
        response = await api.get(`/orders/my/${orderId}`);
      }
      setOrder(response.data);
      const discAmt = response.data?.discount_amount || response.data?.discount || 0;
      if (discAmt > 0) { setDiscountInput(String(discAmt)); setDiscountApplied(true); }
    } catch (e: any) {
      if (!isAdmin && e?.response?.status === 404) {
        setOrder(null);
      } else if (isAdmin) {
        try {
          const fallback = await api.get(`/orders/my/${orderId}`);
          setOrder(fallback.data);
        } catch {
          setOrder(null);
        }
      } else {
        setOrder(null);
      }
      console.error('Error fetching order:', e);
    } finally {
      setLoading(false);
    }
  };

  // ── Status update: same URL approach as useOrderOperations ────────────
  const updateOrderStatus = useCallback(async (newStatus: string) => {
    setUpdatingStatus(newStatus);
    try {
      await api.patch(`/orders/${orderId}/status?status=${newStatus}`);
      setOrder((prev) => prev ? { ...prev, status: newStatus } : null);
    } catch (error: any) {
      Alert.alert(
        language === 'ar' ? 'خطأ' : 'Error',
        error?.response?.data?.detail || 'Failed to update status'
      );
    } finally {
      setUpdatingStatus(null);
    }
  }, [orderId, language]);

  const handleCancelOrder = useCallback(() => {
    showConfirm({
      title: language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order',
      message: language === 'ar' ? 'هل أنت متأكد من إلغاء هذا الطلب؟' : 'Are you sure you want to cancel this order?',
      confirmText: language === 'ar' ? 'نعم' : 'Yes',
      cancelText: language === 'ar' ? 'لا' : 'No',
      onConfirm: async () => {
        setUpdatingStatus('cancelled');
        try {
          await api.patch(`/orders/${orderId}/status?status=cancelled`);
          setOrder((prev) => prev ? { ...prev, status: 'cancelled' } : null);
        } catch (e) { console.error(e); }
        finally { setUpdatingStatus(null); }
      },
    });
  }, [orderId, language, showConfirm]);

  const handleCustomerCancelOrder = useCallback(() => {
    showConfirm({
      title: language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order',
      message: language === 'ar' ? 'هل أنت متأكد من إلغاء هذا الطلب؟ لا يمكن التراجع بعد الشحن.' : 'Are you sure you want to cancel? Cannot cancel after shipping.',
      confirmText: language === 'ar' ? 'نعم، إلغاء' : 'Yes, Cancel',
      cancelText: language === 'ar' ? 'لا' : 'No',
      onConfirm: async () => {
        setUpdatingStatus('cancelled');
        try {
          await api.patch(`/orders/my/${orderId}/cancel`);
          setOrder((prev) => prev ? { ...prev, status: 'cancelled' } : null);
        } catch (e: any) {
          Alert.alert(
            language === 'ar' ? 'خطأ' : 'Error',
            e?.response?.data?.detail || (language === 'ar' ? 'تعذر إلغاء الطلب' : 'Failed to cancel order')
          );
        } finally { setUpdatingStatus(null); }
      },
    });
  }, [orderId, language, showConfirm]);

  const handleDeleteOrder = useCallback(() => {
    showConfirm({
      title: language === 'ar' ? 'حذف الطلب نهائياً' : 'Delete Order Permanently',
      message: language === 'ar' ? 'سيتم حذف هذا الطلب نهائياً. هل أنت متأكد؟' : 'This order will be permanently deleted. Are you sure?',
      confirmText: language === 'ar' ? 'حذف' : 'Delete',
      cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.delete(`/orders/${orderId}`);
          router.back();
        } catch (e) { console.error(e); setDeleting(false); }
      },
    });
  }, [orderId, language, router, showConfirm]);

  const applyDiscount = async () => {
    const amt = parseFloat(discountInput);
    if (isNaN(amt) || amt < 0) {
      Alert.alert(language === 'ar' ? 'خطأ' : 'Error', language === 'ar' ? 'قيمة خصم غير صحيحة' : 'Invalid discount value');
      return;
    }
    setApplyingDiscount(true);
    try {
      const res = await api.patch(`/orders/${orderId}/discount`, { discount: amt });
      setOrder((prev) => prev ? { ...prev, discount: amt, total: res.data.total, total_amount: res.data.total } : null);
      setDiscountApplied(true);
    } catch (e: any) {
      Alert.alert(language === 'ar' ? 'خطأ' : 'Error', e?.response?.data?.detail || 'Error');
    } finally { setApplyingDiscount(false); }
  };

  const clearDiscount = async () => {
    setApplyingDiscount(true);
    try {
      const res = await api.patch(`/orders/${orderId}/discount`, { discount: 0 });
      setOrder((prev) => prev ? { ...prev, discount: 0, total: res.data.total, total_amount: res.data.total } : null);
      setDiscountInput(''); setDiscountApplied(false);
    } catch (e) { console.error(e); }
    finally { setApplyingDiscount(false); }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const pressFab = () => {
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.88, duration: 80, useNativeDriver: true }),
      Animated.timing(fabScale, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    setShowExportModal(true);
  };

  // ── Loading / Error states ────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header title={language === 'ar' ? 'تفاصيل الطلب' : 'Order Details'} showBack showSearch={false} showCart={false} />
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!order) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
        <Header title={language === 'ar' ? 'تفاصيل الطلب' : 'Order Details'} showBack showSearch={false} showCart={false} />
        <View style={styles.center}>
          <Text style={{ color: colors.error, fontSize: 16 }}>{language === 'ar' ? 'الطلب غير موجود' : 'Order not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Price calculations (using correct field: unit_price) ──────────────
  const itemsArray: RichOrderItem[] = Array.isArray(order.items) ? order.items : [];
  const subtotal = itemsArray.length > 0
    ? itemsArray.reduce((sum, item) => sum + (parseFloat(String(item.unit_price || 0)) || 0) * (item.quantity || 1), 0)
    : (parseFloat(String(order.total_amount || 0)) || 0) - (parseFloat(String(order.shipping_cost || SHIPPING_COST)) || SHIPPING_COST);
  const shipping = parseFloat(String(order.shipping_cost || SHIPPING_COST)) || SHIPPING_COST;
  const discount = parseFloat(String(order.discount_amount || order.discount || 0)) || 0;
  const total = parseFloat(String(order.total_amount || order.total || 0)) || (subtotal + shipping - discount);

  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const isAr = language === 'ar';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <Header title={isAr ? 'تفاصيل الطلب' : 'Order Details'} showBack showSearch={false} showCart={false} />

      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 100 }]} showsVerticalScrollIndicator={false}>

        {/* ── Order Header Card ─────────────────────────────────────── */}
        <View style={[styles.orderTopCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.orderTopRow, isRTL && styles.rowRev]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.orderNum, { color: colors.primary }]}>{order.order_number}</Text>
              <Text style={[styles.orderDate, { color: colors.textSecondary }]}>{formatDate(order.created_at ?? '')}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: statusCfg.bg, borderColor: `${statusCfg.color}66` }]}>
              <Ionicons name={statusCfg.icon as any} size={13} color={statusCfg.color} />
              <Text style={[styles.statusPillText, { color: statusCfg.color }]}>
                {isAr ? statusCfg.labelAr : statusCfg.label}
              </Text>
            </View>
            {isOwner && (
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteOrder} disabled={deleting}>
                {deleting ? <ActivityIndicator size="small" color="#EF4444" /> : <Ionicons name="trash-outline" size={18} color="#EF4444" />}
              </TouchableOpacity>
            )}
          </View>
          {/* Progress bar */}
          {order.status !== 'cancelled' && (
            <View style={styles.progressWrap}>
              {STATUS_FLOW.map((s, i) => {
                const done = STATUS_FLOW.indexOf(order.status) >= i;
                return (
                  <React.Fragment key={s}>
                    <View style={[styles.progressDot, { backgroundColor: done ? STATUS_CONFIG[s].color : colors.border }]}>
                      {done && <Ionicons name="checkmark" size={8} color="#FFF" />}
                    </View>
                    {i < STATUS_FLOW.length - 1 && (
                      <View style={[styles.progressLine, { backgroundColor: STATUS_FLOW.indexOf(order.status) > i ? '#10B981' : colors.border }]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>
          )}
        </View>

        {/* ── Status Update (Admin/Owner) ───────────────────────────── */}
        {isAdmin && order.status !== 'cancelled' && order.status !== 'delivered' && (
          <StatusUpdateBar
            order={order}
            language={language}
            isRTL={isRTL}
            updatingStatus={updatingStatus}
            onUpdate={updateOrderStatus}
            onCancel={handleCancelOrder}
            colors={colors}
          />
        )}

        {/* ── Cancel button for customers/subscribers ───────────────── */}
        {!isAdmin && !['shipped', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status) && (
          <TouchableOpacity
            style={[styles.customerCancelBtn, { borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.06)' }]}
            onPress={handleCustomerCancelOrder}
            disabled={updatingStatus !== null}
          >
            {updatingStatus === 'cancelled' ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#EF4444' }}>
                  {isAr ? 'إلغاء الطلب' : 'Cancel Order'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* ── Customer Info ─────────────────────────────────────────── */}
        <CustomerInfoCard order={order} language={language} isRTL={isRTL} colors={colors} />

        {/* ── Order Items ───────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, isRTL && styles.rowRev]}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(59,130,246,0.1)' }]}>
              <Ionicons name="cube-outline" size={16} color="#3B82F6" />
            </View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {isAr ? `المنتجات (${itemsArray.length})` : `Items (${itemsArray.length})`}
            </Text>
          </View>
          {itemsArray.length === 0 ? (
            <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingVertical: 16 }}>
              {isAr ? 'لا توجد منتجات' : 'No items'}
            </Text>
          ) : (
            groupOrderItemsBySku(itemsArray).map(({ groupKey, entries }) => (
              <GroupedOrderCard
                key={groupKey}
                entries={entries}
                language={language}
                isRTL={isRTL}
                colors={colors}
                onPressProduct={(pid) => pid && router.push(`/product/${pid}`)}
                onPressBundle={(oid) => oid && router.push(`/offer/${oid}`)}
              />
            ))
          )}
        </View>

        {/* ── Order Summary ─────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, isRTL && styles.rowRev]}>
            <View style={[styles.cardIcon, { backgroundColor: 'rgba(245,158,11,0.1)' }]}>
              <Ionicons name="calculator-outline" size={16} color="#F59E0B" />
            </View>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {isAr ? 'ملخص الطلب' : 'Order Summary'}
            </Text>
          </View>

          {/* Subtotal row */}
          <View style={[styles.sumRow, isRTL && styles.rowRev]}>
            <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>{isAr ? 'المجموع الفرعي' : 'Subtotal'}</Text>
            <Text style={[styles.sumValue, { color: colors.text }]}>{subtotal.toFixed(2)} ج.م</Text>
          </View>
          {/* Shipping row with optional subscriber discount badge */}
          <View style={[styles.sumRow, isRTL && styles.rowRev]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              <Text style={[styles.sumLabel, { color: colors.textSecondary }]}>{isAr ? 'الشحن' : 'Shipping'}</Text>
              {String(order.notes || '').includes('delivery_discount:subscriber_single_restaurant') && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(122,31,43,0.12)', borderWidth: 1, borderColor: 'rgba(122,31,43,0.35)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6 }}>
                  <Ionicons name="star" size={9} color="#7A1F2B" />
                  <Text style={{ fontSize: 9, fontWeight: '700', color: '#7A1F2B' }}>
                    {isAr ? 'خصم مشترك' : 'Subscriber'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.sumValue, { color: colors.text }]}>{shipping.toFixed(2)} ج.م</Text>
          </View>

          {/* Discount section */}
          <View style={[styles.discountSection, { borderColor: colors.border }]}>
            <Text style={[styles.discountLabel, { color: colors.text }]}>
              {isAr ? 'الخصم (ج.م)' : 'Discount (EGP)'}
            </Text>
            {isOwner ? (
              <View style={[styles.discountRow, isRTL && styles.rowRev]}>
                <TextInput
                  style={[styles.discountInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  value={discountInput}
                  onChangeText={setDiscountInput}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textSecondary}
                />
                <TouchableOpacity style={[styles.discBtn, { backgroundColor: '#10B981' }]} onPress={applyDiscount} disabled={applyingDiscount}>
                  {applyingDiscount ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="checkmark" size={18} color="#FFF" />}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.discBtn, { backgroundColor: '#EF4444' }]} onPress={clearDiscount} disabled={applyingDiscount}>
                  <Ionicons name="close" size={18} color="#FFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[styles.discountDisplay, { color: discount > 0 ? '#10B981' : colors.textSecondary }]}>
                {discount > 0 ? `-${discount.toFixed(2)} ج.م` : (isAr ? 'لا يوجد خصم' : 'No discount')}
              </Text>
            )}
          </View>

          {discount > 0 && (
            <View style={[styles.sumRow, isRTL && styles.rowRev]}>
              <Text style={[styles.sumLabel, { color: '#10B981' }]}>{isAr ? 'الخصم' : 'Discount'}</Text>
              <Text style={[styles.sumValue, { color: '#10B981' }]}>-{discount.toFixed(2)} ج.م</Text>
            </View>
          )}

          {/* Grand total */}
          <View style={[styles.totalRow, { borderColor: colors.border }, isRTL && styles.rowRev]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>{isAr ? 'الإجمالي النهائي' : 'Grand Total'}</Text>
            <View style={{ alignItems: isRTL ? 'flex-start' : 'flex-end' }}>
              {discount > 0 && (
                <Text style={{ color: '#9CA3AF', fontSize: 12, textDecorationLine: 'line-through' }}>
                  {(subtotal + shipping).toFixed(2)} ج.م
                </Text>
              )}
              <Text style={[styles.totalValue, { color: discount > 0 ? '#10B981' : colors.text }]}>{total.toFixed(2)} ج.م</Text>
            </View>
          </View>
        </View>

      </ScrollView>

      {/* ── Floating Export Button ────────────────────────────────── */}
      <Animated.View style={[styles.fab, { bottom: insets.bottom + 20, transform: [{ scale: fabScale }] }]}>
        <TouchableOpacity style={[styles.fabBtn, { backgroundColor: '#6366F1' }]} onPress={pressFab} activeOpacity={0.85}>
          <Ionicons name="share-outline" size={22} color="#FFF" />
        </TouchableOpacity>
      </Animated.View>

      <ExportModal
        visible={showExportModal}
        language={language}
        isRTL={isRTL}
        colors={colors}
        onClose={() => setShowExportModal(false)}
        onPrint={() => { setShowExportModal(false); setTimeout(() => printOrder(order, language), 300); }}
        onWord={() => { setShowExportModal(false); setTimeout(() => downloadWordOrder(order, language), 300); }}
      />

      {ConfirmModalNode}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  orderTopCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  orderTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowRev: { flexDirection: 'row-reverse' },
  orderNum: { fontSize: 18, fontWeight: '800', letterSpacing: 0.5 },
  orderDate: { fontSize: 12, marginTop: 3 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  deleteBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  progressDot: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  progressLine: { flex: 1, height: 2 },

  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  cardIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' },

  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sumLabel: { fontSize: 14 },
  sumValue: { fontSize: 14, fontWeight: '600' },

  discountSection: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 12, marginVertical: 8 },
  discountLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discountInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlign: 'center' },
  discountDisplay: { fontSize: 16, fontWeight: '700' },
  discBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1.5, paddingTop: 14, marginTop: 8 },
  totalLabel: { fontSize: 17, fontWeight: '700' },
  totalValue: { fontSize: 22, fontWeight: '800' },

  customerCancelBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 14, paddingVertical: 13, gap: 8, marginBottom: 14 },
  fab: { position: 'absolute', right: 20, zIndex: 100 },
  fabBtn: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#6366F1', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 },
});

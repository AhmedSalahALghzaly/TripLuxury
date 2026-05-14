import { clog } from "./lib/console-shim";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { query, withTransaction } from "./server-db";
import {
  OrderStatus,
  GetHousekeepingStatsResponse,
  GetHousekeepingStatsByTableQueryParams,
  GetProductStockHistoryQueryParams,
  GetRestaurantStockHistoryQueryParams,
  GetRatingsQueryParams,
  GetAdminRatingsQueryParams,
  GetAdminRatingsExportQueryParams,
  GetPushLogQueryParams,
  GetPushLogUnreadCountQueryParams,
  GetPushLogTopOffendersQueryParams,
} from "@workspace/api-zod";
import {
  generateSessionToken,
  hashPassword,
  comparePassword,
  serializeUser,
  getUserRole,
  getCurrentUser,
  requireAuth,
  requireAdminRole,
  getUserRestaurantIds,
  getPartnerRestaurantId,
  customerBelongsToRestaurant,
  AUTH_USER_COLUMNS,
  SAFE_ADMIN_USER_COLUMNS,
  safeAdminUserColumns,
} from "./server-auth";
import { sendVerificationCode, verifyCode } from "./server-twilio";
import { sendEmailVerificationCode } from "./server-gmail";
import { generateAndUploadExcel } from "./server-excelService";
import { createChatRouter, initChatTables } from "./routes/chat";
import { createKnowledgeBaseRouter } from "./routes/knowledge-base";
import { createAppointmentsRouter } from "./routes/appointments";
import { createAiRouter } from "./routes/ai";
import { createRestaurantAnalyticsRouter } from "./routes/restaurant-analytics";
import { ObjectStorageService, ObjectNotFoundError } from "./lib/objectStorage";
import { canAccessObject, setObjectAclPolicy, ObjectPermission } from "./lib/objectAcl";
import { captureEvent } from "./lib/posthog";

const SHIPPING_COST = 50.0;
const SESSION_EXPIRE_DAYS = 30;

// System user that authors low-stock alerts in the chat inbox.
// A fixed UUID makes the row idempotent across restarts.
const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const SYSTEM_USER_EMAIL = "system@al-ghazaly.local";
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

function genId() {
  return randomUUID();
}

/**
 * Normalize a dish "ingredients" payload into a JSON string suitable for
 * a jsonb column, or null when the caller is clearing the field.
 *
 * Accepts:
 *   - an array of strings (each entry is trimmed and empty entries dropped)
 *   - a multi-line string (split on newlines, then same trimming)
 *   - null / undefined / empty → stored as SQL NULL
 */
function normalizeIngredients(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let arr: unknown[];
  if (Array.isArray(input)) {
    arr = input;
  } else if (typeof input === "string") {
    arr = input.split(/\r?\n/);
  } else {
    return null;
  }
  const cleaned = arr
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

/**
 * Normalize a dish "nutrition" payload into a JSON string for a jsonb
 * column, or null when no usable values were provided. Only the four
 * canonical per-serving fields the dish detail page renders are kept,
 * and each value is coerced to a finite number — anything else is
 * dropped so we never store junk like "abc" or NaN.
 */
function normalizeNutrition(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") return null;
  const src = input as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of ["calories", "protein", "carbs", "fat"]) {
    const raw = src[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (Number.isFinite(n)) out[key] = n;
  }
  if (Object.keys(out).length === 0) return null;
  return JSON.stringify(out);
}

/**
 * Bootstraps the app_settings key-value table and the System user row.
 * Idempotent — safe to call on every server start.
 */
async function initLowStockAlertSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `INSERT INTO app_settings (key, value)
     VALUES ('low_stock_threshold', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_LOW_STOCK_THRESHOLD)],
  );
  await query(
    `INSERT INTO users (id, email, name, password_hash, is_admin, created_at, updated_at)
     VALUES ($1, $2, 'System Alerts', '!system!', false, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [SYSTEM_USER_ID, SYSTEM_USER_EMAIL],
  );
}

async function getLowStockThreshold(): Promise<number> {
  try {
    const r = await query(
      `SELECT value FROM app_settings WHERE key='low_stock_threshold'`,
    );
    if (!r.rows.length) return DEFAULT_LOW_STOCK_THRESHOLD;
    const v = r.rows[0].value;
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string"
          ? parseInt(v, 10)
          : Number(v);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOW_STOCK_THRESHOLD;
  } catch {
    return DEFAULT_LOW_STOCK_THRESHOLD;
  }
}

/**
 * Pushes a chat message + WS event to every admin/owner when a product variant
 * crosses the low-stock threshold (i.e. oldStock > threshold && newStock <= threshold).
 * The message lands in a dedicated 'system_alert' conversation per admin so it
 * appears as a normal entry in the chat inbox in real time.
 */
async function maybeFireLowStockAlert(opts: {
  productId: string;
  fitmentIndicator: string | null;
  oldStock: number;
  newStock: number;
}): Promise<void> {
  const { productId, fitmentIndicator, oldStock, newStock } = opts;
  try {
    const threshold = await getLowStockThreshold();
    // Only fire on the threshold-crossing edge — avoids spamming the inbox
    // every time stock decreases while already below the threshold.
    if (oldStock <= threshold || newStock > threshold) return;

    // Pull a fully-enriched product snapshot so the notification card on
    // the client can render a thumbnail, price, SKU and fitment without
    // making a second round-trip. Image falls back to any in-stock SKU
    // sibling so notifications never render with a broken thumbnail when
    // the variant row itself has no image_url.
    const pr = await query(
      `SELECT p.id, p.name, p.name_ar, p.sku, p.price,
              COALESCE(p.image_url, (
                SELECT s2.image_url FROM products s2
                WHERE s2.sku = p.sku AND s2.deleted_at IS NULL
                  AND s2.image_url IS NOT NULL
                ORDER BY (COALESCE(s2.fitment_indicator,'صغير')='صغير') DESC
                LIMIT 1
              )) AS image_url,
              pb.name AS product_brand_name,
              COALESCE(cars.list, '[]'::jsonb) AS compatible_car_models,
              COALESCE(p.car_model_ids, '[]'::jsonb) AS restaurant_ids
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar
           ) ORDER BY cm.name), '[]'::jsonb) AS list
           FROM (
             SELECT elem::uuid AS cm_id
             FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS elem
             LIMIT 3
           ) ids
           JOIN car_models cm ON cm.id = ids.cm_id
         ) cars ON TRUE
         WHERE p.id=$1`,
      [productId],
    );
    const product = pr.rows[0];
    if (!product) return;

    const indicatorPart = fitmentIndicator ? ` (${fitmentIndicator})` : "";
    const arBody =
      `⚠️ تنبيه مخزون منخفض\n` +
      `المنتج: ${product.name_ar || product.name}${indicatorPart}\n` +
      `رمز المنتج (SKU): ${product.sku || "-"}\n` +
      `الكمية المتبقية: ${newStock}\n` +
      `الحد المحدد: ${threshold}`;

    const notifMeta = {
      kind: "low_stock",
      product_id: productId,
      sku: product.sku,
      name: product.name,
      name_ar: product.name_ar,
      image_url: product.image_url || null,
      price: product.price != null ? Number(product.price) : null,
      fitment_indicator: fitmentIndicator,
      stock: newStock,
      threshold,
      // Enriched for unified product-card rendering across surfaces
      // (NotificationCenter card, system-alert chat). Stored in
      // notifications.metadata so consumers don't make extra round-trips.
      product_brand_name: product.product_brand_name || null,
      compatible_car_models: product.compatible_car_models || [],
    };

    const adminsRes = await query(
      `SELECT DISTINCT u.id FROM users u
       WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL)
          OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)`,
    );

    for (const row of adminsRes.rows) {
      const adminId = row.id;
      if (!adminId || adminId === SYSTEM_USER_ID) continue;

      // Persist a notification card so the stock alert is visible in the
      // bell-tray UI (not only in the system-alert chat). Distinct from
      // the chat message INSERT below: the chat message is for the inbox
      // surface, this one drives the notification panel.
      const notifId = genId();
      await query(
        `INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,'warning',$7)`,
        [
          notifId,
          adminId,
          "Low Stock",
          "مخزون منخفض",
          `Product "${product.name}${indicatorPart}" stock is low (${newStock} left)`,
          `المنتج "${product.name_ar || product.name}${indicatorPart}" مخزونه منخفض (${newStock} متبقي)`,
          JSON.stringify(notifMeta),
        ],
      );
      broadcastToUser(adminId, {
        type: "notification",
        data: {
          id: notifId,
          title: "مخزون منخفض",
          message: `المنتج "${product.name_ar || product.name}${indicatorPart}" مخزونه منخفض (${newStock} متبقي)`,
          type: "warning",
          read: false,
          created_at: new Date().toISOString(),
          metadata: notifMeta,
        },
      });

      // Find or create a system→admin conversation
      let convId: string;
      const conv = await query(
        `SELECT id FROM conversations
         WHERE user_id=$1 AND agent_id=$2 AND type='system_alert' AND deleted_at IS NULL
         LIMIT 1`,
        [adminId, SYSTEM_USER_ID],
      );
      if (conv.rows.length) {
        convId = conv.rows[0].id;
      } else {
        const newConv = await query(
          `INSERT INTO conversations (user_id, agent_id, type, status, ai_auto_reply)
           VALUES ($1, $2, 'system_alert', 'active', false) RETURNING id`,
          [adminId, SYSTEM_USER_ID],
        );
        convId = newConv.rows[0].id;
      }

      const msg = await query(
        `INSERT INTO messages (conversation_id, sender_id, sender_type, content, message_type)
         VALUES ($1, $2, 'system', $3, 'low_stock_alert')
         RETURNING id, created_at`,
        [convId, SYSTEM_USER_ID, arBody],
      );

      // Real-time WS push so the inbox updates instantly.
      // Shape MUST match the rest of the chat_message broadcasts
      // (`{ type, message, conversation_id }`) — useChat.ts reads
      // `data.message`, so emitting `data: {...}` here would land as
      // `undefined` on the client and crash `prev.some(c => c.id === msg.conversation_id)`.
      broadcastToUser(adminId, {
        type: "chat_message",
        message: {
          id: msg.rows[0].id,
          conversation_id: convId,
          sender_id: SYSTEM_USER_ID,
          sender_type: "system",
          content: arBody,
          message_type: "low_stock_alert",
          is_read: false,
          created_at: msg.rows[0].created_at,
        },
        conversation_id: convId,
      });
      broadcastToUser(adminId, {
        type: "low_stock_alert",
        data: {
          product_id: productId,
          sku: product.sku,
          name: product.name,
          name_ar: product.name_ar,
          fitment_indicator: fitmentIndicator,
          stock: newStock,
          threshold,
        },
      });
    }

    // Log one row to push_notification_log so the alert appears in the
    // notification history screen (event_type: 'low_stock').
    const allAdminIds = (adminsRes.rows as { id: string }[])
      .map((r) => r.id)
      .filter((id) => id && id !== SYSTEM_USER_ID);
    if (allAdminIds.length > 0) {
      const indicatorPart2 = fitmentIndicator ? ` (${fitmentIndicator})` : "";
      query(
        `INSERT INTO push_notification_log
           (event_type, title, body, title_en, title_ar, body_en, body_ar, payload, recipient_user_ids, recipient_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          "low_stock",
          `⚠️ Low Stock: ${product.name}${indicatorPart2}`,
          `SKU: ${product.sku || "-"} · ${newStock} remaining (threshold: ${threshold})`,
          `⚠️ Low Stock: ${product.name}${indicatorPart2}`,
          `⚠️ مخزون منخفض: ${product.name_ar || product.name}${indicatorPart2}`,
          `SKU: ${product.sku || "-"} · ${newStock} remaining (threshold: ${threshold})`,
          `الرمز: ${product.sku || "-"} · ${newStock} متبقي (الحد: ${threshold})`,
          JSON.stringify({
            product_id: productId,
            sku: product.sku,
            name: product.name,
            name_ar: product.name_ar,
            image_url: product.image_url || null,
            fitment_indicator: fitmentIndicator,
            stock: newStock,
            threshold,
            restaurant_ids: product.restaurant_ids || [],
          }),
          JSON.stringify(allAdminIds),
          allAdminIds.length,
        ],
      ).catch((e: any) =>
        clog.error("[lowStockAlert] push_notification_log insert failed", e?.message),
      );
    }
  } catch (err: any) {
    clog.error("[lowStockAlert] failed", err?.message || err);
  }
}

function addDays(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Restore stock for every item in an order (called on cancellation).
 * Handles both standard stock_quantity and JSONB fitment_stock_variants models.
 */
async function restoreStockForOrder(orderId: string): Promise<void> {
  const orderRes = await query(`SELECT items FROM orders WHERE id=$1`, [orderId]);
  if (!orderRes.rows.length) return;
  const items: any[] = orderRes.rows[0].items || [];
  for (const item of items) {
    if (!item.product_id || !item.quantity) continue;
    const qty = Number(item.quantity);
    const indicator = item.fitment_indicator
      ? String(item.fitment_indicator).toUpperCase()
      : null;
    const pr = await query(
      `SELECT fitment_stock_variants, stock_quantity FROM products WHERE id=$1 AND deleted_at IS NULL`,
      [item.product_id],
    );
    if (!pr.rows.length) continue;
    const fsv = pr.rows[0].fitment_stock_variants;
    const hasJsonbStock = !!(
      fsv &&
      typeof fsv === "object" &&
      !Array.isArray(fsv) &&
      indicator &&
      Object.prototype.hasOwnProperty.call(fsv, indicator)
    );
    let newStock = 0;
    if (hasJsonbStock) {
      const updated = await query(
        `UPDATE products
           SET fitment_stock_variants = jsonb_set(
             COALESCE(fitment_stock_variants, '{}'::jsonb),
             ARRAY[$2::text],
             to_jsonb(COALESCE((fitment_stock_variants->>$2)::int, 0) + $1::int),
             true
           ),
           updated_at = NOW()
         WHERE id = $3
         RETURNING (fitment_stock_variants->>$2)::int AS new_stock`,
        [qty, indicator, item.product_id],
      );
      newStock = Number(updated.rows?.[0]?.new_stock ?? 0);
    } else {
      const updated = await query(
        `UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2 RETURNING stock_quantity AS new_stock`,
        [qty, item.product_id],
      );
      newStock = Number(updated.rows?.[0]?.new_stock ?? 0);
    }
    // Broadcast restored stock so notification-log mini-cards refresh in real-time
    try {
      broadcastToAll({
        type: 'stock_updated',
        data: { product_id: item.product_id, stock_quantity: newStock },
      });
    } catch {}
  }
}

/**
 * Fire an "out of stock" notification to all admins/owners when a product
 * variant's stock hits exactly 0. Distinct from the low-stock threshold alert.
 */
async function maybeFireOutOfStockAlert(opts: {
  productId: string;
  fitmentIndicator: string | null;
}): Promise<void> {
  const { productId, fitmentIndicator } = opts;
  try {
    // Same enrichment pattern as the low-stock helper: pull image + price
    // up-front (with sibling image fallback) so the notification card on
    // the client can render in full without an extra round-trip.
    const pr = await query(
      `SELECT p.id, p.name, p.name_ar, p.sku, p.price,
              COALESCE(p.image_url, (
                SELECT s2.image_url FROM products s2
                WHERE s2.sku = p.sku AND s2.deleted_at IS NULL
                  AND s2.image_url IS NOT NULL
                ORDER BY (COALESCE(s2.fitment_indicator,'صغير')='صغير') DESC
                LIMIT 1
              )) AS image_url,
              pb.name AS product_brand_name,
              COALESCE(cars.list, '[]'::jsonb) AS compatible_car_models,
              COALESCE(p.car_model_ids, '[]'::jsonb) AS restaurant_ids
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN LATERAL (
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar
           ) ORDER BY cm.name), '[]'::jsonb) AS list
           FROM (
             SELECT elem::uuid AS cm_id
             FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS elem
             LIMIT 3
           ) ids
           JOIN car_models cm ON cm.id = ids.cm_id
         ) cars ON TRUE
         WHERE p.id=$1`,
      [productId],
    );
    const product = pr.rows[0];
    if (!product) return;

    const indicatorPart = fitmentIndicator ? ` (${fitmentIndicator})` : "";
    const arBody =
      `🔴 نفذ المخزون!\n` +
      `المنتج: ${product.name_ar || product.name}${indicatorPart}\n` +
      `رمز المنتج (SKU): ${product.sku || "-"}\n` +
      `الكمية المتبقية: 0\n` +
      `⚠️ يرجى إعادة التوريد فوراً`;

    const adminsRes = await query(
      `SELECT DISTINCT u.id FROM users u
       WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL)
          OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)`,
    );

    for (const row of adminsRes.rows) {
      const adminId = row.id;
      if (!adminId || adminId === SYSTEM_USER_ID) continue;

      const notifId = genId();
      const notifMeta = {
        kind: "out_of_stock",
        product_id: productId,
        sku: product.sku,
        name: product.name,
        name_ar: product.name_ar,
        image_url: product.image_url || null,
        price: product.price != null ? Number(product.price) : null,
        fitment_indicator: fitmentIndicator,
        stock: 0,
        // Same enrichment as low_stock notifMeta — see comment there.
        product_brand_name: product.product_brand_name || null,
        compatible_car_models: product.compatible_car_models || [],
      };
      await query(
        `INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,'error',$7)`,
        [
          notifId,
          adminId,
          "Out of Stock",
          "نفذ المخزون",
          `Product "${product.name}${indicatorPart}" is now out of stock`,
          `المنتج "${product.name_ar || product.name}${indicatorPart}" نفذ من المخزون`,
          JSON.stringify(notifMeta),
        ],
      );
      broadcastToUser(adminId, {
        type: "notification",
        data: {
          id: notifId,
          title: "نفذ المخزون",
          message: `المنتج "${product.name_ar || product.name}${indicatorPart}" نفذ من المخزون`,
          type: "error",
          read: false,
          created_at: new Date().toISOString(),
          metadata: notifMeta,
        },
      });
      broadcastToUser(adminId, { type: "out_of_stock", data: notifMeta });

      // Also deliver via system-alert chat so it surfaces in the inbox

      let convId: string;
      const conv = await query(
        `SELECT id FROM conversations
         WHERE user_id=$1 AND agent_id=$2 AND type='system_alert' AND deleted_at IS NULL
         LIMIT 1`,
        [adminId, SYSTEM_USER_ID],
      );
      if (conv.rows.length) {
        convId = conv.rows[0].id;
      } else {
        const newConv = await query(
          `INSERT INTO conversations (user_id, agent_id, type, status, ai_auto_reply)
           VALUES ($1, $2, 'system_alert', 'active', false) RETURNING id`,
          [adminId, SYSTEM_USER_ID],
        );
        convId = newConv.rows[0].id;
      }
      const msg = await query(
        `INSERT INTO messages (conversation_id, sender_id, sender_type, content, message_type)
         VALUES ($1, $2, 'system', $3, 'out_of_stock_alert') RETURNING id, created_at`,
        [convId, SYSTEM_USER_ID, arBody],
      );
      // Match useChat.ts contract: `{ type, message, conversation_id }`.
      // Emitting `data: {...}` here lands as `undefined` on the client and
      // crashes `prev.some(c => c.id === msg.conversation_id)`.
      broadcastToUser(adminId, {
        type: "chat_message",
        message: {
          id: msg.rows[0].id,
          conversation_id: convId,
          sender_id: SYSTEM_USER_ID,
          sender_type: "system",
          content: arBody,
          message_type: "out_of_stock_alert",
          is_read: false,
          created_at: msg.rows[0].created_at,
        },
        conversation_id: convId,
      });
    }

    // Log one row to push_notification_log so the alert appears in the
    // notification history screen (event_type: 'out_of_stock').
    const allAdminIds = (adminsRes.rows as { id: string }[])
      .map((r) => r.id)
      .filter((id) => id && id !== SYSTEM_USER_ID);
    if (allAdminIds.length > 0) {
      const indicatorPart2 = fitmentIndicator ? ` (${fitmentIndicator})` : "";
      query(
        `INSERT INTO push_notification_log
           (event_type, title, body, title_en, title_ar, body_en, body_ar, payload, recipient_user_ids, recipient_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          "out_of_stock",
          `🔴 Out of Stock: ${product.name}${indicatorPart2}`,
          `SKU: ${product.sku || "-"} · Stock has reached 0 — restock immediately`,
          `🔴 Out of Stock: ${product.name}${indicatorPart2}`,
          `🔴 نفذ المخزون: ${product.name_ar || product.name}${indicatorPart2}`,
          `SKU: ${product.sku || "-"} · Stock has reached 0 — restock immediately`,
          `الرمز: ${product.sku || "-"} · وصل المخزون إلى 0 — أعد التخزين فوراً`,
          JSON.stringify({
            product_id: productId,
            sku: product.sku,
            name: product.name,
            name_ar: product.name_ar,
            image_url: product.image_url || null,
            fitment_indicator: fitmentIndicator,
            stock: 0,
            restaurant_ids: product.restaurant_ids || [],
          }),
          JSON.stringify(allAdminIds),
          allAdminIds.length,
        ],
      ).catch((e: any) =>
        clog.error("[outOfStockAlert] push_notification_log insert failed", e?.message),
      );
    }
  } catch (err: any) {
    clog.error("[outOfStockAlert] failed", err?.message || err);
  }
}

// WebSocket client tracking (module-level for access across the function)
const wsClients = new Map<string, Set<WebSocket>>();
const wsAnonClients = new Set<WebSocket>();

export function broadcastToUser(userId: string, message: object) {
  const userClients = wsClients.get(userId);
  if (!userClients) return;
  const payload = JSON.stringify(message);
  for (const ws of userClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export function broadcastToAll(message: object) {
  const payload = JSON.stringify(message);
  for (const userClients of wsClients.values()) {
    for (const ws of userClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
  for (const ws of wsAnonClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

/**
 * Send a websocket message to a specific set of authenticated user IDs only.
 * Anonymous (logged-out) sockets are NEVER included — use this for any
 * payload that contains customer PII or per-user state.
 */
export function broadcastToUsers(userIds: Iterable<string>, message: object) {
  const payload = JSON.stringify(message);
  const seen = new Set<string>();
  for (const uid of userIds) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const userClients = wsClients.get(uid);
    if (!userClients) continue;
    for (const ws of userClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(cookieParser());

  // Run migrations that may not exist yet
  try {
    await query(
      "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'",
    );
  } catch {}
  try {
    await query(
      "ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_last_read_status VARCHAR(50)",
    );
    await query(
      "ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_read_at TIMESTAMPTZ",
    );
  } catch {}
  // Per-dish editorial fields surfaced on the dish detail page (Task #7).
  // Additive jsonb/text columns; safe to run on every boot.
  try {
    await query(
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients JSONB",
    );
    await query(
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS ingredients_ar JSONB",
    );
    await query(
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS pairing_notes TEXT",
    );
    await query(
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS pairing_notes_ar TEXT",
    );
    await query(
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS nutrition JSONB",
    );
  } catch {}

  // Composite indexes to make admin customer profile queries
  // (favorites/cart/orders) index-only on (user_id, created_at DESC).
  try {
    await query(
      "CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC)",
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_cart_items_user_created ON cart_items(user_id, created_at DESC)",
    );
    await query(
      "CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC)",
    );
  } catch (e: any) {
    clog.error("[DB] Failed to create composite indexes:", e?.message);
  }

  // Initialize chat & knowledge base tables
  try {
    await initChatTables();
  } catch (e: any) {
    clog.error("[Chat] Failed to initialize tables:", e.message);
  }

  // Bootstrap app_settings table + System user for low-stock alerts
  try {
    await initLowStockAlertSchema();
    clog.log("[LowStockAlert] schema ready");
  } catch (e: any) {
    clog.error("[LowStockAlert] schema init failed:", e.message);
  }

  // Bootstrap order_number_seq — used by POST /api/orders and the admin
  // create-order route to mint zero-padded 7-digit human-readable order
  // numbers. Idempotent: CREATE SEQUENCE IF NOT EXISTS, then advance the
  // sequence past whatever orders already exist so we never collide with
  // historical numbers on a fresh DB / restored backup.
  try {
    await query(
      "CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1 INCREMENT BY 1",
    );
    // Best-effort catch-up so a fresh sequence on an existing orders table
    // doesn't try to mint already-taken order numbers.
    await query(
      `SELECT setval(
         'order_number_seq',
         GREATEST(
           COALESCE((SELECT MAX(NULLIF(regexp_replace(order_number, '\\D', '', 'g'), '')::bigint) FROM orders), 0),
           (SELECT last_value FROM order_number_seq)
         )
       )`,
    );
    clog.log("[Orders] order_number_seq ready");
  } catch (e: any) {
    clog.error("[Orders] order_number_seq init failed:", e?.message);
  }

  // ==================== RATE LIMITERS ====================
  // Generous limits — protect against credential stuffing and cart abuse
  // without ever blocking normal end-user behaviour.  Limiters are applied
  // per-IP using the trust-proxy-aware default key generator.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 20, // 20 attempts / IP / 15 min — well above any legit user
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true, // only count failed login attempts
    message: { detail: "rate_limited", message: "محاولات كثيرة، حاول لاحقاً" },
  });
  const cartAddLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 120, // 120 add-to-cart calls / IP / minute
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { detail: "rate_limited", message: "محاولات كثيرة، حاول لاحقاً" },
  });

  // ==================== AUTH ROUTES ====================

  // Register with email/password
  app.post("/api/auth/register", authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        return res
          .status(400)
          .json({ detail: "Email, password and name are required" });
      }

      const existing = await query("SELECT id FROM users WHERE email = $1", [
        email.toLowerCase(),
      ]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ detail: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const userId = genId();

      await query(
        "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())",
        [userId, email.toLowerCase(), name, passwordHash],
      );

      const userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE id = $1", [
        userId,
      ]);
      const user = userResult.rows[0];
      const role = await getUserRole(user.email);

      const sessionToken = generateSessionToken();
      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), userId, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      const userSerialized = await serializeUser(user);
      userSerialized.role = role;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      clog.error("Register error:", err);
      return res.status(500).json({ detail: "Registration failed" });
    }
  });

  // Login with email/password
  app.post("/api/auth/login", authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res
          .status(400)
          .json({ detail: "Email and password are required" });
      }

      const userResult = await query(
        "SELECT id, email, name, picture, is_admin, phone, phone_verified, subscription_status, created_at, preferred_language, replit_user_id, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL",
        [email.toLowerCase()],
      );

      if (userResult.rows.length === 0) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }

      const user = userResult.rows[0];

      if (!user.password_hash) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }

      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }

      const role = await getUserRole(user.email);
      const sessionToken = generateSessionToken();

      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      const userSerialized = await serializeUser(user);
      userSerialized.role = role;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      clog.error("Login error:", err);
      return res.status(500).json({ detail: "Login failed" });
    }
  });

  // Change password
  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    try {
      const { email, old_password, new_password } = req.body;
      if (!email || !old_password || !new_password) {
        return res.status(400).json({ detail: "All fields are required" });
      }
      if (new_password.length < 6) {
        return res
          .status(400)
          .json({ detail: "New password must be at least 6 characters" });
      }
      const userResult = await query(
        "SELECT id, email, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL",
        [email.toLowerCase()],
      );
      if (userResult.rows.length === 0) {
        return res.status(401).json({ detail: "Invalid email or password" });
      }
      const user = userResult.rows[0];
      if (!user.password_hash) {
        return res
          .status(401)
          .json({ detail: "This account does not use password login" });
      }
      const valid = await comparePassword(old_password, user.password_hash);
      if (!valid) {
        return res
          .status(401)
          .json({ detail: "Current password is incorrect" });
      }
      const newHash = await hashPassword(new_password);
      await query(
        "UPDATE users SET password_hash = $1, owner_temp_password = NULL, updated_at = NOW() WHERE id = $2",
        [newHash, user.id],
      );
      // Invalidate all existing sessions for security
      await query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
      clog.info(`[Auth] Password changed for: ${user.email}`);
      return res.json({
        success: true,
        message: "Password changed successfully. Please sign in again.",
      });
    } catch (err: any) {
      clog.error("Change password error:", err);
      return res.status(500).json({ detail: "Failed to change password" });
    }
  });

  // Get current user
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) {
        return res.status(401).json({ detail: "Not authenticated" });
      }
      const role = await getUserRole(user.email);
      const userSerialized = await serializeUser(user);
      userSerialized.role = role;
      return res.json(userSerialized);
    } catch (err: any) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  // Update the authenticated user's preferred language
  app.patch("/api/auth/me/language", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ detail: "Not authenticated" });
      const { preferred_language } = req.body;
      if (preferred_language !== "en" && preferred_language !== "ar") {
        return res.status(400).json({ detail: "preferred_language must be 'en' or 'ar'" });
      }
      await query(
        "UPDATE users SET preferred_language=$1, updated_at=NOW() WHERE id=$2",
        [preferred_language, userId],
      );
      return res.json({ preferred_language });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ── User saved addresses (home / work / club) ──────────────────────────
  // Used by /checkout to fast-fill the delivery form and by /profile to
  // manage the 3 slots. label is constrained at the DB layer; each user
  // can have at most one row per label (UNIQUE user_id, label).
  const ADDRESS_LABELS = ["home", "work", "club"] as const;
  type AddressLabel = (typeof ADDRESS_LABELS)[number];

  app.get(
    "/api/user-addresses",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id;
        const r = await query(
          `SELECT id, label, address, governorate, city, latitude, longitude,
                  phone, notes, created_at, updated_at
             FROM user_addresses
            WHERE user_id = $1
            ORDER BY CASE label
              WHEN 'home' THEN 1 WHEN 'work' THEN 2 WHEN 'club' THEN 3 ELSE 9
            END`,
          [userId],
        );
        return res.json({ addresses: r.rows });
      } catch (err: any) {
        req.log.error({ err }, "GET /user-addresses failed");
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Upsert a single slot. Body: { label, address, governorate, city,
  // latitude, longitude, phone, notes }. Replaces the row for that label.
  app.put(
    "/api/user-addresses/:label",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id;
        const label = String(req.params.label || "").toLowerCase() as AddressLabel;
        if (!ADDRESS_LABELS.includes(label)) {
          return res.status(400).json({
            detail: `label must be one of ${ADDRESS_LABELS.join(", ")}`,
          });
        }
        const {
          address = null,
          governorate = null,
          city = null,
          latitude = null,
          longitude = null,
          phone = null,
          notes = null,
        } = req.body || {};
        const r = await query(
          `INSERT INTO user_addresses
             (user_id, label, address, governorate, city, latitude, longitude, phone, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id, label) DO UPDATE SET
             address     = EXCLUDED.address,
             governorate = EXCLUDED.governorate,
             city        = EXCLUDED.city,
             latitude    = EXCLUDED.latitude,
             longitude   = EXCLUDED.longitude,
             phone       = EXCLUDED.phone,
             notes       = EXCLUDED.notes,
             updated_at  = NOW()
           RETURNING id, label, address, governorate, city, latitude, longitude,
                     phone, notes, created_at, updated_at`,
          [userId, label, address, governorate, city, latitude, longitude, phone, notes],
        );
        return res.json({ address: r.rows[0] });
      } catch (err: any) {
        req.log.error({ err }, "PUT /user-addresses/:label failed");
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/user-addresses/:label",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id;
        const label = String(req.params.label || "").toLowerCase() as AddressLabel;
        if (!ADDRESS_LABELS.includes(label)) {
          return res.status(400).json({ detail: "Invalid label" });
        }
        await query(
          "DELETE FROM user_addresses WHERE user_id = $1 AND label = $2",
          [userId, label],
        );
        return res.json({ ok: true });
      } catch (err: any) {
        req.log.error({ err }, "DELETE /user-addresses/:label failed");
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Google OAuth - exchange access token for session
  app.post("/api/auth/google", authLimiter, async (req: Request, res: Response) => {
    let step = "init";
    try {
      const { access_token } = req.body;
      if (!access_token)
        return res.status(400).json({ detail: "Access token required" });

      step = "google_userinfo";
      let googleRes: globalThis.Response;
      try {
        googleRes = await fetch(
          "https://www.googleapis.com/oauth2/v3/userinfo",
          {
            headers: { Authorization: `Bearer ${access_token}` },
          },
        );
      } catch (fetchErr: any) {
        clog.error(
          "Google auth: failed to reach userinfo endpoint:",
          fetchErr?.message || fetchErr,
        );
        return res
          .status(502)
          .json({ detail: "Could not reach Google servers" });
      }

      if (!googleRes.ok) {
        const body = await googleRes.text().catch(() => "");
        clog.error(
          `Google auth: userinfo returned ${googleRes.status}:`,
          body,
        );
        return res.status(401).json({ detail: "Invalid Google token" });
      }

      step = "parse_google_user";
      const googleUser: any = await googleRes.json();
      const { email, name, picture } = googleUser;
      if (!email)
        return res
          .status(400)
          .json({ detail: "Could not get email from Google" });

      step = "db_lookup";
      let userResult = await query(
        "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
        [email.toLowerCase()],
      );

      let userId: string;
      step = "db_upsert";
      if (userResult.rows.length === 0) {
        userId = genId();
        await query(
          "INSERT INTO users (id, email, name, picture, email_verified, created_at, updated_at) VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())",
          [userId, email.toLowerCase(), name || email, picture || null],
        );
        userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE id = $1", [userId]);
      } else {
        userId = userResult.rows[0].id;
        await query(
          "UPDATE users SET picture = COALESCE($1, picture), email_verified = TRUE, name = COALESCE(NULLIF($2,''), name), updated_at = NOW() WHERE id = $3",
          [picture || null, name || "", userId],
        );
        userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE id = $1", [userId]);
      }

      step = "session_create";
      const user = userResult.rows[0];
      const role = await getUserRole(user.email);
      const sessionToken = generateSessionToken();
      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      step = "serialize";
      const userSerialized = await serializeUser(user);
      userSerialized.role = role;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      // PostHog: track login vs signup
      try {
        const isNew = userResult.rows.length === 0;
        captureEvent(userId, isNew ? "user_signed_up" : "user_logged_in", {
          provider: "google",
          email: email.toLowerCase(),
          role,
        });
      } catch {}

      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      clog.error(
        `Google auth error at step [${step}]:`,
        err?.message || err,
      );
      return res
        .status(500)
        .json({ detail: `Google authentication failed (${step})` });
    }
  });

  // Replit Auth - exchange Replit user headers for a session
  app.post("/api/auth/replit-login", async (req: Request, res: Response) => {
    try {
      const replitUserId = req.headers["x-replit-user-id"] as string;
      const replitUserName = req.headers["x-replit-user-name"] as string;
      const replitUserEmail = req.headers["x-replit-user-email"] as string;
      const replitUserImage = req.headers["x-replit-user-image"] as string;
      const replitUserRoles = req.headers["x-replit-user-roles"] as string;

      if (!replitUserId || !replitUserName) {
        return res
          .status(401)
          .json({ detail: "Not authenticated with Replit" });
      }

      const rawName = decodeURIComponent(replitUserName);
      const rawEmail = replitUserEmail
        ? decodeURIComponent(replitUserEmail)
        : null;
      const rawPicture = replitUserImage
        ? decodeURIComponent(replitUserImage)
        : null;
      const email = rawEmail || `${replitUserName.toLowerCase()}@replit.user`;

      // Find existing user by replit_user_id first, then by email
      let userResult = await query(
        "SELECT id FROM users WHERE (replit_user_id = $1 OR email = $2) AND deleted_at IS NULL ORDER BY (replit_user_id = $1) DESC LIMIT 1",
        [replitUserId, email.toLowerCase()],
      );

      let userId: string;
      if (userResult.rows.length === 0) {
        userId = genId();
        await query(
          `INSERT INTO users (id, email, name, picture, email_verified, replit_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
           ON CONFLICT (email) DO UPDATE
             SET replit_user_id = EXCLUDED.replit_user_id,
                 name = COALESCE(NULLIF(EXCLUDED.name,''), users.name),
                 picture = COALESCE(EXCLUDED.picture, users.picture),
                 email_verified = TRUE,
                 updated_at = NOW()`,
          [
            userId,
            email.toLowerCase(),
            rawName || email,
            rawPicture,
            replitUserId,
          ],
        );
        userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE email = $1", [
          email.toLowerCase(),
        ]);
        userId = userResult.rows[0].id;
      } else {
        userId = userResult.rows[0].id;
        await query(
          `UPDATE users SET
             replit_user_id = $1,
             name = COALESCE(NULLIF($2,''), name),
             picture = COALESCE($3, picture),
             email_verified = TRUE,
             updated_at = NOW()
           WHERE id = $4`,
          [replitUserId, rawName || "", rawPicture, userId],
        );
        userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE id = $1", [userId]);
      }

      const user = userResult.rows[0];
      const role = await getUserRole(user.email);
      const sessionToken = generateSessionToken();

      await query(
        "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
        [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
      );

      const userSerialized = await serializeUser(user);
      userSerialized.role = role;
      userSerialized.replit_user_id = replitUserId;

      res.cookie("session_token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      clog.info(
        `[Replit Auth] Login: ${user.email} role=${role} replit_id=${replitUserId}`,
      );
      return res.json({ user: userSerialized, session_token: sessionToken });
    } catch (err: any) {
      clog.error("Replit auth error:", err);
      return res
        .status(500)
        .json({ detail: "Replit authentication failed: " + err.message });
    }
  });

  // Check Replit Auth status (GET - for auto-login on page load)
  app.get("/api/auth/replit-status", async (req: Request, res: Response) => {
    try {
      const replitUserId = req.headers["x-replit-user-id"] as string;
      const replitUserName = req.headers["x-replit-user-name"] as string;
      const replitUserEmail = req.headers["x-replit-user-email"] as string;

      // Check existing session first
      const existingUser = await getCurrentUser(req);
      if (existingUser) {
        const role = await getUserRole(existingUser.email);
        const s = await serializeUser(existingUser);
        s.role = role;
        return res.json({ authenticated: true, via: "session", user: s });
      }

      // If Replit headers present, auto-create session
      if (replitUserId && replitUserName) {
        const rawEmail = replitUserEmail
          ? decodeURIComponent(replitUserEmail)
          : null;
        const email = rawEmail || `${replitUserName.toLowerCase()}@replit.user`;

        let userResult = await query(
          "SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE (replit_user_id = $1 OR email = $2) AND deleted_at IS NULL LIMIT 1",
          [replitUserId, email.toLowerCase()],
        );

        let userId: string;
        if (userResult.rows.length === 0) {
          // Auto-create user on first Replit Auth login
          const rawPicture2 = req.headers["x-replit-user-image"]
            ? decodeURIComponent(req.headers["x-replit-user-image"] as string)
            : null;
          const rawName2 = decodeURIComponent(replitUserName);
          userId = genId();
          await query(
            `INSERT INTO users (id, email, name, picture, email_verified, replit_user_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
             ON CONFLICT (email) DO UPDATE
               SET replit_user_id = EXCLUDED.replit_user_id,
                   name = COALESCE(NULLIF(EXCLUDED.name,''), users.name),
                   picture = COALESCE(EXCLUDED.picture, users.picture),
                   email_verified = TRUE,
                   updated_at = NOW()`,
            [
              userId,
              email.toLowerCase(),
              rawName2 || email,
              rawPicture2,
              replitUserId,
            ],
          );
          userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE email = $1", [
            email.toLowerCase(),
          ]);
        }
        userId = userResult.rows[0].id;
        const user = userResult.rows[0];
        const role = await getUserRole(user.email);
        const sessionToken = generateSessionToken();
        await query(
          "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
          [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
        );
        const s = await serializeUser(user);
        s.role = role;
        res.cookie("session_token", sessionToken, {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/",
          maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
        });
        clog.info(`[Replit Status] Auto-login: ${user.email} role=${role}`);
        return res.json({
          authenticated: true,
          via: "replit_headers",
          user: s,
          session_token: sessionToken,
        });
      }

      return res.json({ authenticated: false, replit_user_present: false });
    } catch (err: any) {
      clog.error("Replit status error:", err);
      return res.status(500).json({ detail: "Status check failed" });
    }
  });

  // Validate Replit session token (used after WebBrowser redirect)
  app.post("/api/auth/replit-validate", async (req: Request, res: Response) => {
    try {
      const { session_token } = req.body;
      if (!session_token)
        return res.status(400).json({ detail: "Session token required" });

      const sessionResult = await query(
        "SELECT user_id FROM sessions WHERE session_token = $1 AND expires_at > NOW()",
        [session_token],
      );
      if (sessionResult.rows.length === 0) {
        return res
          .status(401)
          .json({ detail: "Invalid or expired session token" });
      }
      const session = sessionResult.rows[0];
      const userResult = await query(
        "SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE id = $1 AND deleted_at IS NULL",
        [session.user_id],
      );
      if (userResult.rows.length === 0) {
        return res.status(401).json({ detail: "User not found" });
      }
      const user = userResult.rows[0];
      const role = await getUserRole(user.email);
      const s = await serializeUser(user);
      s.role = role;

      res.cookie("session_token", session_token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_EXPIRE_DAYS * 24 * 60 * 60 * 1000,
      });

      return res.json({ user: s, session_token });
    } catch (err: any) {
      clog.error("Replit validate error:", err);
      return res.status(500).json({ detail: "Validation failed" });
    }
  });

  // Replit Sign-In HTML page - serves a landing page for Replit Auth WebBrowser flow
  app.get("/auth/replit-signin", async (req: Request, res: Response) => {
    const isMobile = req.query.mobile === "1";
    const redirectUrl = (req.query.redirect as string) || "/";

    try {
      // Read Replit user headers (available in deployed Replit apps)
      const replitUserId = req.headers["x-replit-user-id"] as string;
      const replitUserName = req.headers["x-replit-user-name"] as string;
      const replitUserEmail = req.headers["x-replit-user-email"] as string;
      const replitUserImage = req.headers["x-replit-user-image"] as string;

      if (replitUserId && replitUserName) {
        // User is authenticated via Replit - create/find user and session
        const rawName = decodeURIComponent(replitUserName);
        const rawEmail = replitUserEmail
          ? decodeURIComponent(replitUserEmail)
          : null;
        const rawPicture = replitUserImage
          ? decodeURIComponent(replitUserImage)
          : null;
        const email = rawEmail || `${replitUserName.toLowerCase()}@replit.user`;

        let userResult = await query(
          "SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE (replit_user_id = $1 OR email = $2) AND deleted_at IS NULL ORDER BY (replit_user_id = $1) DESC LIMIT 1",
          [replitUserId, email.toLowerCase()],
        );

        let userId: string;
        if (userResult.rows.length === 0) {
          userId = genId();
          await query(
            `INSERT INTO users (id, email, name, picture, email_verified, replit_user_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
             ON CONFLICT (email) DO UPDATE
               SET replit_user_id = EXCLUDED.replit_user_id,
                   updated_at = NOW()`,
            [
              userId,
              email.toLowerCase(),
              rawName || email,
              rawPicture,
              replitUserId,
            ],
          );
          userResult = await query("SELECT " + AUTH_USER_COLUMNS + " FROM users WHERE email = $1", [
            email.toLowerCase(),
          ]);
        }

        const user = userResult.rows[0];
        const sessionToken = generateSessionToken();
        await query(
          "INSERT INTO sessions (id, user_id, session_token, expires_at) VALUES ($1, $2, $3, $4)",
          [genId(), user.id, sessionToken, addDays(SESSION_EXPIRE_DAYS)],
        );

        clog.info(
          `[Replit SignIn Page] Login: ${user.email} mobile=${isMobile}`,
        );

        if (isMobile) {
          // For mobile: redirect back to app with token
          const mobileRedirect = decodeURIComponent(redirectUrl);
          const separator = mobileRedirect.includes("?") ? "&" : "?";
          return res.redirect(
            `${mobileRedirect}${separator}token=${sessionToken}`,
          );
        } else {
          // For web: redirect to original page with token
          const webRedirect = new URL(
            redirectUrl.startsWith("http")
              ? redirectUrl
              : `${req.protocol}://${req.get("host")}`,
          );
          webRedirect.searchParams.set("replit_token", sessionToken);
          return res.redirect(webRedirect.toString());
        }
      } else {
        // Not authenticated via headers — redirect to Replit's official auth flow
        // After the user authenticates with Replit, they return to the app and
        // checkReplitStatus() on the login page auto-detects the session
        const host = req.get("host") || "";
        const hostname = host.split(":")[0]; // strip port
        const replitAuthUrl = `https://replit.com/auth_with_repl_site?domain=${encodeURIComponent(hostname)}`;
        clog.info(
          `[Replit SignIn] No headers — redirecting to Replit auth: ${replitAuthUrl}`,
        );
        return res.redirect(replitAuthUrl);
      }
    } catch (err: any) {
      clog.error("Replit signin page error:", err);
      return res.status(500).send("Server error");
    }
  });

  // Send email verification code
  app.post(
    "/api/auth/send-email-verification",
    async (req: Request, res: Response) => {
      try {
        const { email, language } = req.body;
        if (!email) return res.status(400).json({ detail: "Email required" });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await query("DELETE FROM email_verification_codes WHERE email = $1", [
          email.toLowerCase(),
        ]);
        await query(
          "INSERT INTO email_verification_codes (email, code, expires_at) VALUES ($1, $2, $3)",
          [email.toLowerCase(), code, expiresAt],
        );

        await sendEmailVerificationCode(email, code, language || "ar");
        return res.json({ message: "Verification code sent" });
      } catch (err: any) {
        clog.error("Send email verification error:", err);
        return res
          .status(500)
          .json({ detail: err.message || "Failed to send verification email" });
      }
    },
  );

  // Verify email code
  app.post(
    "/api/auth/verify-email-code",
    async (req: Request, res: Response) => {
      try {
        const { email, code } = req.body;
        if (!email || !code)
          return res.status(400).json({ detail: "Email and code required" });

        const updateResult = await query(
          "UPDATE email_verification_codes SET used = TRUE WHERE email = $1 AND code = $2 AND expires_at > NOW() AND used = FALSE",
          [email.toLowerCase(), code.trim()],
        );

        if ((updateResult.rowCount ?? 0) === 0) {
          return res
            .status(400)
            .json({ detail: "Invalid or expired code" });
        }

        await query("UPDATE users SET email_verified = TRUE WHERE email = $1", [
          email.toLowerCase(),
        ]);

        return res.json({ message: "Email verified successfully" });
      } catch (err: any) {
        clog.error("Verify email error:", err);
        return res.status(500).json({ detail: "Verification failed" });
      }
    },
  );

  // Logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const token =
        req.cookies?.session_token ||
        req.headers?.authorization?.replace("Bearer ", "");
      if (token) {
        await query("DELETE FROM sessions WHERE session_token = $1", [token]);
      }
      res.clearCookie("session_token", { path: "/" });
      return res.json({ message: "Logged out" });
    } catch {
      return res.json({ message: "Logged out" });
    }
  });

  // ==================== CAR BRANDS ====================

  app.get("/api/car-brands", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT cb.*, d.name as distributor_name 
         FROM car_brands cb 
         LEFT JOIN distributors d ON cb.distributor_id = d.id 
         WHERE cb.deleted_at IS NULL 
         ORDER BY cb.name`,
      );
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/car-brands",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, logo, distributor_id } = req.body;
        if (!name || !name_ar)
          return res.status(400).json({ detail: "name and name_ar required" });

        const result = await query(
          "INSERT INTO car_brands (id, name, name_ar, logo, distributor_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
          [genId(), name, name_ar, logo || null, distributor_id || null],
        );
        broadcastToAll({ type: "car_brand_created", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/car-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, logo, distributor_id } = req.body;
        const result = await query(
          "UPDATE car_brands SET name=$1, name_ar=$2, logo=$3, distributor_id=$4, updated_at=NOW() WHERE id=$5 AND deleted_at IS NULL RETURNING *",
          [name, name_ar, logo || null, distributor_id || null, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        broadcastToAll({ type: "car_brand_updated", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/car-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE car_brands SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({
          type: "car_brand_deleted",
          data: { id: req.params.id },
        });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CAR MODELS ====================

  app.get("/api/car-models", async (req: Request, res: Response) => {
    try {
      const { brand_id, open_now } = req.query;
      let q = `SELECT cm.*, cb.name as brand_name, cb.name_ar as brand_name_ar, cb.logo as brand_logo,
                      COALESCE(
                        (SELECT json_agg(json_build_object(
                                  'day_of_week', rh.day_of_week,
                                  'open_minutes', rh.open_minutes,
                                  'close_minutes', rh.close_minutes,
                                  'is_closed', rh.is_closed
                                ) ORDER BY rh.day_of_week)
                         FROM restaurant_hours rh
                         WHERE rh.restaurant_id = cm.id),
                        '[]'::json
                      ) AS hours
               FROM car_models cm
               LEFT JOIN car_brands cb ON COALESCE(cm.car_brand_id, cm.brand_id) = cb.id
               WHERE cm.deleted_at IS NULL`;
      const params: any[] = [];
      if (brand_id) {
        params.push(brand_id);
        q += ` AND cm.brand_id = $${params.length}`;
      }
      if (open_now === "true") {
        // current_mins: minutes elapsed since UTC midnight
        // today_dow:    0=Sunday … 6=Saturday (UTC)
        // prev_dow:     yesterday's day-of-week (wraps Sunday→Saturday)
        // Three cases cover normal windows and both halves of overnight windows:
        //   1. today, normal   (open<=close): open <= now < close
        //   2. today, overnight (open>close): now >= open  (we're in the late-night portion)
        //   3. yesterday, overnight (open>close): now < close (previous day's window spills past midnight)
        q += `
          AND EXISTS (
            SELECT 1 FROM restaurant_hours rh
            WHERE rh.restaurant_id = cm.id
              AND rh.is_closed = FALSE
              AND rh.open_minutes IS NOT NULL
              AND rh.close_minutes IS NOT NULL
              AND (
                (
                  rh.day_of_week = EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::SMALLINT
                  AND rh.open_minutes <= rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER >= rh.open_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER < rh.close_minutes
                )
                OR (
                  rh.day_of_week = EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::SMALLINT
                  AND rh.open_minutes > rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER >= rh.open_minutes
                )
                OR (
                  rh.day_of_week = ((EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::INTEGER + 6) % 7)::SMALLINT
                  AND rh.open_minutes > rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER < rh.close_minutes
                )
              )
          )`;
      }
      q += " ORDER BY cm.name";
      const result = await query(q, params);
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.get("/api/car-models/:id", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT cm.*, cb.id as brand_obj_id, cb.name as brand_name, cb.name_ar as brand_name_ar, cb.logo as brand_logo,
                cb.distributor_id as brand_distributor_id,
                d.id as dist_id, d.name as dist_name,
                d.email as dist_email, d.contact_email as dist_contact_email,
                d.contact_phone as dist_phone, d.website as dist_website_url,
                d.logo as dist_logo, d.country as dist_country, d.notes as dist_description,
                ls.id as lsupp_id, ls.name as lsupp_name,
                ls.logo as lsupp_image, ls.contact_email as lsupp_email,
                ls.website as lsupp_website, ls.notes as lsupp_desc
         FROM car_models cm
         LEFT JOIN car_brands cb ON COALESCE(cm.car_brand_id, cm.brand_id) = cb.id
         LEFT JOIN distributors d ON cb.distributor_id = d.id
         LEFT JOIN LATERAL (
           SELECT s.id, s.name, s.logo, s.contact_email,
                  s.website, s.notes
           FROM suppliers s
           WHERE s.linked_restaurant_ids @> jsonb_build_array(cm.id::text)
           AND s.deleted_at IS NULL
           LIMIT 1
         ) ls ON true
         WHERE cm.id = $1 AND cm.deleted_at IS NULL`,
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      const carModel = result.rows[0];
      // Build brand as nested object for frontend compatibility
      carModel.brand = carModel.brand_obj_id
        ? {
            id: carModel.brand_obj_id,
            name: carModel.brand_name,
            name_ar: carModel.brand_name_ar,
            logo: carModel.brand_logo,
          }
        : null;
      carModel.distributor = carModel.dist_id
        ? {
            id: carModel.dist_id,
            name: carModel.dist_name,
            name_ar: null,
            profile_image: carModel.dist_logo || null,
            phone: carModel.dist_phone || null,
            email: carModel.dist_email || carModel.dist_contact_email || null,
            contact_email:
              carModel.dist_contact_email || carModel.dist_email || null,
            website_url: carModel.dist_website_url || null,
            phone_numbers: [],
            address: carModel.dist_country || null,
            description: carModel.dist_description || null,
            description_ar: null,
          }
        : null;
      delete carModel.brand_obj_id;
      delete carModel.brand_name;
      delete carModel.brand_name_ar;
      delete carModel.brand_logo;
      delete carModel.brand_distributor_id;
      delete carModel.dist_id;
      delete carModel.dist_name;
      delete carModel.dist_logo;
      delete carModel.dist_phone;
      delete carModel.dist_email;
      delete carModel.dist_contact_email;
      delete carModel.dist_website_url;
      delete carModel.dist_country;
      delete carModel.dist_description;
      // New: supplier linked directly to this restaurant via linked_restaurant_ids
      carModel.linked_supplier = carModel.lsupp_id
        ? {
            id: carModel.lsupp_id,
            name: carModel.lsupp_name,
            profile_image: carModel.lsupp_image || null,
            contact_email: carModel.lsupp_email || null,
            website_url: carModel.lsupp_website || null,
            description: carModel.lsupp_desc || null,
          }
        : null;
      delete carModel.lsupp_id;
      delete carModel.lsupp_name;
      delete carModel.lsupp_image;
      delete carModel.lsupp_email;
      delete carModel.lsupp_website;
      delete carModel.lsupp_desc;

      // Fetch compatible products (car_model_ids is stored as JSONB array).
      // We piggy-back the per-SKU sibling list (available_variants) via the
      // same LATERAL pattern used by /api/products so the mobile client can
      // dedupe by SKU and render an interactive fitment chip strip with the
      // correct per-fitment price.
      const productsResult = await query(
        `SELECT p.id, p.name, p.name_ar, p.sku, p.price::float as price, p.image_url, p.images,
                COALESCE(p.fitment_indicator,'صغير') AS fitment_indicator,
                p.stock_quantity,
                c.id as category_id, c.name as category_name, c.name_ar as category_name_ar,
                pb.id as product_brand_id, pb.name as brand_name, pb.name_ar as brand_name_ar,
                COALESCE(variants.list, '[]'::jsonb) as available_variants
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', s.id,
             'indicator', COALESCE(s.fitment_indicator,'صغير'),
             'price', s.price,
             'stock', s.stock_quantity
           ) ORDER BY (COALESCE(s.fitment_indicator,'صغير')='صغير') DESC,
                      COALESCE(s.fitment_indicator,'صغير')) AS list
           FROM products s
           WHERE s.sku = p.sku
             AND p.sku IS NOT NULL AND p.sku <> ''
             AND s.deleted_at IS NULL
             AND (s.hidden_status = FALSE OR s.hidden_status IS NULL)
         ) variants ON TRUE
         WHERE p.car_model_ids @> $1::jsonb AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT 50`,
        [JSON.stringify([req.params.id])],
      );

      const compatibleProducts = productsResult.rows.map((p: Record<string, any>) => ({
        ...p,
        price: parseFloat(p.price) || 0,
        available_variants: p.available_variants || [],
        category: p.category_name
          ? {
              id: p.category_id,
              name: p.category_name,
              name_ar: p.category_name_ar,
            }
          : null,
        product_brand: p.brand_name
          ? {
              id: p.product_brand_id,
              name: p.brand_name,
              name_ar: p.brand_name_ar,
            }
          : null,
      }));

      return res.json({
        ...carModel,
        compatible_products: compatibleProducts,
        compatible_products_count: compatibleProducts.length,
      });
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/car-models",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          brand_id,
          name,
          name_ar,
          year_start,
          year_end,
          image_url,
          images,
          description,
          description_ar,
          variants,
          chassis_number,
          catalog_pdf,
          fuel_type,
          video_url,
          receipt_language,
        } = req.body;
        if (!brand_id || !name || !name_ar)
          return res
            .status(400)
            .json({ detail: "brand_id, name, name_ar required" });

        const safeReceiptLang = ['auto', 'ar', 'en'].includes(receipt_language)
          ? receipt_language
          : 'auto';

        const result = await query(
          `INSERT INTO car_models (id, brand_id, car_brand_id, name, name_ar, year_start, year_end, image_url, images, description, description_ar, variants, chassis_number, catalog_pdf, fuel_type, video_url, receipt_language, latitude, longitude)
         VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            genId(),
            brand_id,
            name,
            name_ar,
            year_start || null,
            year_end || null,
            image_url || null,
            JSON.stringify(images || []),
            description || null,
            description_ar || null,
            JSON.stringify(variants || []),
            chassis_number || null,
            catalog_pdf || null,
            fuel_type || "petrol",
            video_url || null,
            safeReceiptLang,
            req.body.latitude != null && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null,
            req.body.longitude != null && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null,
          ],
        );
        broadcastToAll({ type: "car_model_created", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/car-models/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          brand_id,
          name,
          name_ar,
          year_start,
          year_end,
          image_url,
          images,
          description,
          description_ar,
          variants,
          chassis_number,
          catalog_pdf,
          fuel_type,
          video_url,
          receipt_language,
        } = req.body;
        // When receipt_language is absent (partial update from older clients),
        // preserve the existing DB value via COALESCE rather than forcing 'auto'.
        const safeReceiptLangUpd = ['auto', 'ar', 'en'].includes(receipt_language)
          ? receipt_language
          : null;
        const result = await query(
          `UPDATE car_models SET brand_id=$1,car_brand_id=$1,name=$2,name_ar=$3,year_start=$4,year_end=$5,image_url=$6,images=$7,description=$8,description_ar=$9,variants=$10,chassis_number=$11,catalog_pdf=$12,fuel_type=$13,video_url=$14,receipt_language=COALESCE($15, receipt_language),latitude=$16,longitude=$17,updated_at=NOW()
         WHERE id=$18 AND deleted_at IS NULL RETURNING *`,
          [
            brand_id,
            name,
            name_ar,
            year_start || null,
            year_end || null,
            image_url || null,
            JSON.stringify(images || []),
            description || null,
            description_ar || null,
            JSON.stringify(variants || []),
            chassis_number || null,
            catalog_pdf || null,
            fuel_type || "petrol",
            video_url || null,
            safeReceiptLangUpd,
            req.body.latitude != null && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null,
            req.body.longitude != null && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        broadcastToAll({ type: "car_model_updated", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/car-models/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE car_models SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({
          type: "car_model_deleted",
          data: { id: req.params.id },
        });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== RESTAURANT HOURS ====================

  app.get(
    "/api/car-models/hours/bulk",
    async (req: Request, res: Response) => {
      try {
        const raw = req.query.ids;
        const ids: string[] =
          typeof raw === "string"
            ? raw.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
        if (ids.length === 0) return res.json({});
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
        const result = await query(
          `SELECT restaurant_id, day_of_week, open_minutes, close_minutes, is_closed
           FROM restaurant_hours
           WHERE restaurant_id IN (${placeholders})
           ORDER BY day_of_week`,
          ids,
        );
        const map: Record<
          string,
          { day_of_week: number; open_minutes: number | null; close_minutes: number | null; is_closed: boolean }[]
        > = {};
        for (const row of result.rows) {
          if (!map[row.restaurant_id]) map[row.restaurant_id] = [];
          map[row.restaurant_id].push({
            day_of_week: row.day_of_week,
            open_minutes: row.open_minutes,
            close_minutes: row.close_minutes,
            is_closed: row.is_closed,
          });
        }
        return res.json(map);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/car-models/:id/hours",
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT day_of_week, open_minutes, close_minutes, is_closed
           FROM restaurant_hours
           WHERE restaurant_id = $1
           ORDER BY day_of_week`,
          [req.params.id],
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/car-models/:id/hours",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { hours } = req.body as {
          hours: Array<{
            day_of_week: number;
            open_minutes: number | null;
            close_minutes: number | null;
            is_closed: boolean;
          }>;
        };
        if (!Array.isArray(hours)) {
          return res.status(400).json({ detail: "hours array required" });
        }
        const rows = await withTransaction(async (q) => {
          for (const h of hours) {
            await q(
              `INSERT INTO restaurant_hours (id, restaurant_id, day_of_week, open_minutes, close_minutes, is_closed, updated_at)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
               ON CONFLICT (restaurant_id, day_of_week)
               DO UPDATE SET open_minutes=$3, close_minutes=$4, is_closed=$5, updated_at=NOW()`,
              [
                req.params.id,
                h.day_of_week,
                h.open_minutes ?? null,
                h.close_minutes ?? null,
                !!h.is_closed,
              ],
            );
          }
          const updated = await q(
            `SELECT day_of_week, open_minutes, close_minutes, is_closed
             FROM restaurant_hours WHERE restaurant_id=$1 ORDER BY day_of_week`,
            [req.params.id],
          );
          return updated.rows;
        });
        return res.json(rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PRODUCT BRANDS ====================

  app.get("/api/product-brands", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT pb.*, s.name as supplier_name 
         FROM product_brands pb 
         LEFT JOIN suppliers s ON pb.supplier_id = s.id 
         WHERE pb.deleted_at IS NULL ORDER BY pb.name`,
      );
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/product-brands",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          logo,
          country_of_origin,
          country_of_origin_ar,
          supplier_id,
        } = req.body;
        if (!name) return res.status(400).json({ detail: "name required" });

        const result = await query(
          "INSERT INTO product_brands (id, name, name_ar, logo, country_of_origin, country_of_origin_ar, supplier_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            genId(),
            name,
            name_ar || null,
            logo || null,
            country_of_origin || null,
            country_of_origin_ar || null,
            supplier_id || null,
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/product-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          logo,
          country_of_origin,
          country_of_origin_ar,
          supplier_id,
        } = req.body;
        const result = await query(
          "UPDATE product_brands SET name=$1,name_ar=$2,logo=$3,country_of_origin=$4,country_of_origin_ar=$5,supplier_id=$6,updated_at=NOW() WHERE id=$7 AND deleted_at IS NULL RETURNING *",
          [
            name,
            name_ar || null,
            logo || null,
            country_of_origin || null,
            country_of_origin_ar || null,
            supplier_id || null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/product-brands/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE product_brands SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CATEGORIES ====================

  app.get("/api/categories/all", async (req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name",
      );
      return res.json(result.rows);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.get("/api/categories/tree", async (req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name",
      );
      const cats = result.rows;

      const map: Record<string, any> = {};
      cats.forEach((c: any) => {
        map[c.id] = { ...c, children: [] };
      });

      const roots: any[] = [];
      cats.forEach((c: any) => {
        if (c.parent_id && map[c.parent_id]) {
          map[c.parent_id].children.push(map[c.id]);
        } else {
          roots.push(map[c.id]);
        }
      });

      return res.json(roots);
    } catch (err) {
      return res.status(500).json({ detail: "Server error" });
    }
  });

  app.post(
    "/api/categories",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, parent_id, icon, image_data } = req.body;
        if (!name || !name_ar)
          return res.status(400).json({ detail: "name and name_ar required" });

        const result = await query(
          "INSERT INTO categories (id, name, name_ar, parent_id, icon, image_data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            genId(),
            name,
            name_ar,
            parent_id || null,
            icon || null,
            image_data || null,
          ],
        );
        broadcastToAll({ type: "category_created", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/categories/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { name, name_ar, parent_id, icon, image_data } = req.body;
        const result = await query(
          "UPDATE categories SET name=$1,name_ar=$2,parent_id=$3,icon=$4,image_data=$5,updated_at=NOW() WHERE id=$6 AND deleted_at IS NULL RETURNING *",
          [
            name,
            name_ar,
            parent_id || null,
            icon || null,
            image_data || null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        broadcastToAll({ type: "category_updated", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/categories/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE categories SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({ type: "category_deleted", data: { id: req.params.id } });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PRODUCTS ====================

  async function enrichProduct(p: any): Promise<any> {
    const product = { ...p };
    if (!product.car_model_ids) product.car_model_ids = [];
    if (!product.images) product.images = [];
    return product;
  }

  app.get("/api/products", async (req: Request, res: Response) => {
    try {
      const {
        category_id,
        product_brand_id,
        car_model_id,
        car_brand_id,
        min_price,
        max_price,
        skip = 0,
        limit = 50,
        include_hidden,
        is_tire,
        product_type,
        fitment,
        open_now,
      } = req.query;

      let conditions = ["p.deleted_at IS NULL"];
      const params: any[] = [];
      let paramIdx = 1;

      // Restaurant-manager scoping: if the caller is a restaurant_user, restrict
      // products to only those belonging to their assigned restaurants. This
      // prevents managers from browsing products from other restaurants.
      const callerUser = await getCurrentUser(req);
      if (callerUser) {
        const callerRole = await getUserRole(callerUser.email);
        if (callerRole === "restaurant_user") {
          const managerRestaurantIds = await getUserRestaurantIds(callerUser.id);
          if (managerRestaurantIds.length === 0) {
            return res.json({ products: [], total: 0 });
          }
          const overlapConds = managerRestaurantIds.map((rid) => {
            params.push(JSON.stringify([rid]));
            const pIdx = paramIdx++;
            return `p.car_model_ids @> $${pIdx}::jsonb`;
          });
          conditions.push(`(${overlapConds.join(" OR ")})`);
        }
      }

      if (!include_hidden || include_hidden === "false") {
        conditions.push(`(p.hidden_status = FALSE OR p.hidden_status IS NULL)`);
      }

      if (category_id) {
        const subCats = await query(
          "SELECT id FROM categories WHERE parent_id = $1 AND deleted_at IS NULL",
          [category_id],
        );
        const catIds = [category_id, ...subCats.rows.map((r: any) => r.id)];
        conditions.push(`p.category_id = ANY($${paramIdx})`);
        params.push(catIds);
        paramIdx++;
      }

      if (product_brand_id) {
        conditions.push(`p.product_brand_id = $${paramIdx}`);
        params.push(product_brand_id);
        paramIdx++;
      }

      if (car_model_id) {
        conditions.push(`p.car_model_ids @> $${paramIdx}::jsonb`);
        params.push(JSON.stringify([car_model_id]));
        paramIdx++;
      }

      if (car_brand_id) {
        const models = await query(
          "SELECT id FROM car_models WHERE brand_id = $1 AND deleted_at IS NULL",
          [car_brand_id],
        );
        if (models.rows.length > 0) {
          const modelIds = models.rows.map((m: any) => m.id);
          const carModelConditions = modelIds.map(
            (id: string) => `p.car_model_ids @> '["${id}"]'::jsonb`,
          );
          conditions.push(`(${carModelConditions.join(" OR ")})`);
        }
      }

      if (min_price) {
        conditions.push(`p.price >= $${paramIdx}`);
        params.push(Number(min_price));
        paramIdx++;
      }

      if (max_price) {
        conditions.push(`p.price <= $${paramIdx}`);
        params.push(Number(max_price));
        paramIdx++;
      }

      // Product type filter (CSV: tire,accessory,exterior). Preferred over is_tire.
      if (product_type) {
        const ALLOWED_PT = ["tire", "accessory", "exterior"] as const;
        const list = String(product_type)
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is (typeof ALLOWED_PT)[number] =>
            (ALLOWED_PT as readonly string[]).includes(s),
          );
        if (list.length > 0) {
          conditions.push(`p.product_type = ANY($${paramIdx})`);
          params.push(list);
          paramIdx++;
        }
      } else if (typeof is_tire !== "undefined") {
        // Backward-compat tire filter (kept so existing clients keep working)
        if (String(is_tire) === "true") {
          conditions.push(
            `(p.product_type = 'tire' OR (p.product_type IS NULL AND p.is_tire = TRUE))`,
          );
        } else if (String(is_tire) === "false") {
          conditions.push(
            `(p.product_type IS DISTINCT FROM 'tire' AND (p.is_tire = FALSE OR p.is_tire IS NULL))`,
          );
        }
      }

      // Fitment filter (CSV of indicators) — restricts SKU groups to those
      // having at least one variant matching any of the selected indicators.
      if (fitment) {
        const list = String(fitment)
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        if (list.length > 0) {
          conditions.push(
            `EXISTS (SELECT 1 FROM products sp
                     WHERE sp.sku = p.sku AND sp.deleted_at IS NULL
                       AND COALESCE(sp.fitment_indicator,'صغير') = ANY($${paramIdx}))`,
          );
          params.push(list);
          paramIdx++;
        }
      }

      // Open Now filter — restrict to products linked to at least one currently-open
      // restaurant. Uses the same three-case time logic as GET /api/car-models.
      if (open_now === "true") {
        conditions.push(
          `EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS rid
            JOIN restaurant_hours rh ON rh.restaurant_id = rid::uuid
            WHERE rh.is_closed = FALSE
              AND rh.open_minutes IS NOT NULL
              AND rh.close_minutes IS NOT NULL
              AND (
                (
                  rh.day_of_week = EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::SMALLINT
                  AND rh.open_minutes <= rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER >= rh.open_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER < rh.close_minutes
                )
                OR (
                  rh.day_of_week = EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::SMALLINT
                  AND rh.open_minutes > rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER >= rh.open_minutes
                )
                OR (
                  rh.day_of_week = ((EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::INTEGER + 6) % 7)::SMALLINT
                  AND rh.open_minutes > rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER < rh.close_minutes
                )
              )
          )`,
        );
      }

      const whereClause = conditions.join(" AND ");

      // Customer view: deduplicate per SKU, prefer STD row, fall back gracefully
      // for products with no SKU (treat each row as unique by id).
      const countResult = await query(
        `SELECT COUNT(*) FROM (
           SELECT DISTINCT ON (COALESCE(NULLIF(p.sku,''), p.id::text)) p.id
           FROM products p
           WHERE ${whereClause}
           ORDER BY COALESCE(NULLIF(p.sku,''), p.id::text),
                    (COALESCE(p.fitment_indicator,'صغير')='صغير') DESC,
                    p.created_at DESC
         ) sub`,
        params,
      );
      const total = parseInt(countResult.rows[0].count);

      const productsResult = await query(
        `WITH base AS (
           SELECT DISTINCT ON (COALESCE(NULLIF(p.sku,''), p.id::text)) p.id, p.created_at
           FROM products p
           WHERE ${whereClause}
           ORDER BY COALESCE(NULLIF(p.sku,''), p.id::text),
                    (COALESCE(p.fitment_indicator,'صغير')='صغير') DESC,
                    p.created_at DESC
         )
         SELECT p.*,
                pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                pb.country_of_origin as manufacturer_country, pb.country_of_origin_ar as manufacturer_country_ar,
                c.name as category_name, c.name_ar as category_name_ar,
                first_cm.name as compatible_car_model, first_cm.name_ar as compatible_car_model_ar,
                first_cm.year_start as compatible_car_year_from, first_cm.year_end as compatible_car_year_to,
                cb.name as compatible_car_brand, cb.name_ar as compatible_car_brand_ar,
                jsonb_array_length(COALESCE(p.car_model_ids, '[]'::jsonb)) as compatible_car_models_count,
                COALESCE(variants.list, '[]'::jsonb) as available_variants
         FROM base
         JOIN products p ON p.id = base.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT cm.id, cm.name, cm.name_ar, cm.year_start, cm.year_end,
                  COALESCE(cm.car_brand_id, cm.brand_id) AS resolved_brand_id
           FROM car_models cm
           WHERE p.car_model_ids IS NOT NULL
             AND jsonb_array_length(p.car_model_ids) > 0
             AND cm.id = (p.car_model_ids->>0)::uuid
             AND cm.deleted_at IS NULL
           LIMIT 1
         ) first_cm ON TRUE
         LEFT JOIN car_brands cb ON first_cm.resolved_brand_id = cb.id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', s.id,
             'indicator', COALESCE(s.fitment_indicator,'صغير'),
             'price', s.price,
             'stock', s.stock_quantity
           ) ORDER BY (COALESCE(s.fitment_indicator,'صغير')='صغير') DESC,
                      COALESCE(s.fitment_indicator,'صغير')) AS list
           FROM products s
           WHERE s.sku = p.sku
             AND p.sku IS NOT NULL AND p.sku <> ''
             AND s.deleted_at IS NULL
             AND (s.hidden_status = FALSE OR s.hidden_status IS NULL)
         ) variants ON TRUE
         ORDER BY base.created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, Number(limit), Number(skip)],
      );

      const products = productsResult.rows.map((p: any) => ({
        ...p,
        car_model_ids: p.car_model_ids || [],
        images: p.images || [],
        available_variants: p.available_variants || [],
      }));

      return res.json({ products, total });
    } catch (err: any) {
      clog.error("Products error:", err);
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get(
    "/api/products/all",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT p.*,
                pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                c.name as category_name, c.name_ar as category_name_ar
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.deleted_at IS NULL
         ORDER BY p.created_at DESC`,
        );
        return res.json({
          products: result.rows.map((p: any) => ({
            ...p,
            car_model_ids: p.car_model_ids || [],
            images: p.images || [],
          })),
          total: result.rows.length,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get("/api/products/search", async (req: Request, res: Response) => {
    try {
      const { q, is_tire, product_type, fitment, open_now } = req.query;
      const hasQ = typeof q === "string" && q.trim().length > 0;
      // G2 FTS: $1 is the plain query for plainto_tsquery('arabic', ...),
      // $2 is the ILIKE pattern used as a fallback for partial SKU matches
      // and very short queries that produce an empty tsquery.
      const qText = hasQ ? (q as string).trim() : "";
      const qLike = hasQ ? `%${qText}%` : "";
      const params: any[] = hasQ ? [qText, qLike] : [];
      let paramIdx = hasQ ? 3 : 1;
      const extraConds: string[] = [];

      if (product_type) {
        const ALLOWED_PT = ["tire", "accessory", "exterior"] as const;
        const list = String(product_type)
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is (typeof ALLOWED_PT)[number] =>
            (ALLOWED_PT as readonly string[]).includes(s),
          );
        if (list.length > 0) {
          extraConds.push(`p.product_type = ANY($${paramIdx})`);
          params.push(list);
          paramIdx++;
        }
      } else if (typeof is_tire !== "undefined") {
        if (String(is_tire) === "true")
          extraConds.push(
            `(p.product_type = 'tire' OR (p.product_type IS NULL AND p.is_tire = TRUE))`,
          );
        else if (String(is_tire) === "false")
          extraConds.push(
            `(p.product_type IS DISTINCT FROM 'tire' AND (p.is_tire = FALSE OR p.is_tire IS NULL))`,
          );
      }

      if (fitment) {
        const list = String(fitment)
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        if (list.length > 0) {
          extraConds.push(
            `EXISTS (SELECT 1 FROM products sp
                     WHERE sp.sku = p.sku AND sp.deleted_at IS NULL
                       AND COALESCE(sp.fitment_indicator,'صغير') = ANY($${paramIdx}))`,
          );
          params.push(list);
          paramIdx++;
        }
      }

      // Open Now filter — same three-case UTC time logic as GET /api/car-models and GET /api/products.
      if (open_now === "true") {
        extraConds.push(
          `EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS rid
            JOIN restaurant_hours rh ON rh.restaurant_id = rid::uuid
            WHERE rh.is_closed = FALSE
              AND rh.open_minutes IS NOT NULL
              AND rh.close_minutes IS NOT NULL
              AND (
                (
                  rh.day_of_week = EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::SMALLINT
                  AND rh.open_minutes <= rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER >= rh.open_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER < rh.close_minutes
                )
                OR (
                  rh.day_of_week = EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::SMALLINT
                  AND rh.open_minutes > rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER >= rh.open_minutes
                )
                OR (
                  rh.day_of_week = ((EXTRACT(DOW FROM NOW() AT TIME ZONE 'UTC')::INTEGER + 6) % 7)::SMALLINT
                  AND rh.open_minutes > rh.close_minutes
                  AND (EXTRACT(EPOCH FROM (NOW() AT TIME ZONE 'UTC')::TIME) / 60)::INTEGER < rh.close_minutes
                )
              )
          )`,
        );
      }

      const extraWhere = extraConds.length ? " AND " + extraConds.join(" AND ") : "";

      // CANONICALIZATION RULE:
      // 1. Group rows by SKU and pick the STD representative via DISTINCT ON.
      // 2. Apply text (q) and fitment filters at the SKU-GROUP level using
      //    EXISTS, so a match against any variant (e.g. an 020-only row) still
      //    returns the canonical STD card to the customer.
      // G2 FTS: text matching uses search_vector @@ plainto_tsquery('arabic'::regconfig, $1)
      // (Arabic stemming + English+SKU tokens via 'simple') with an ILIKE($2)
      // fallback for partial SKUs and queries shorter than the dictionary's
      // token length.  Ranking aggregates the max ts_rank across the SKU
      // group so the canonical STD card is ordered by the best variant match.
      const result = await query(
        `WITH base AS (
           SELECT DISTINCT ON (COALESCE(NULLIF(p.sku,''), p.id::text))
                  p.id, p.created_at
                  ${hasQ ? `, (
                    SELECT COALESCE(MAX(ts_rank(gp.search_vector, plainto_tsquery('arabic'::regconfig, $1))), 0)
                         + CASE WHEN bool_or(gp.sku ILIKE $2) THEN 0.05 ELSE 0 END
                    FROM products gp
                    WHERE gp.deleted_at IS NULL
                      AND COALESCE(NULLIF(gp.sku,''), gp.id::text) = COALESCE(NULLIF(p.sku,''), p.id::text)
                  ) AS rank` : ""}
           FROM products p
           WHERE p.deleted_at IS NULL
             AND (p.hidden_status = FALSE OR p.hidden_status IS NULL)
             ${hasQ ? `AND EXISTS (
               SELECT 1 FROM products gp
               WHERE gp.deleted_at IS NULL
                 AND (gp.hidden_status = FALSE OR gp.hidden_status IS NULL)
                 AND COALESCE(NULLIF(gp.sku,''), gp.id::text) = COALESCE(NULLIF(p.sku,''), p.id::text)
                 AND (
                       gp.search_vector @@ plainto_tsquery('arabic'::regconfig, $1)
                    OR gp.sku ILIKE $2
                 )
             )` : ""}
             ${extraWhere}
           ORDER BY COALESCE(NULLIF(p.sku,''), p.id::text),
                    (COALESCE(p.fitment_indicator,'صغير')='صغير') DESC,
                    p.created_at DESC
         )
         SELECT p.*,
                pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                pb.country_of_origin as manufacturer_country, pb.country_of_origin_ar as manufacturer_country_ar,
                c.name as category_name, c.name_ar as category_name_ar,
                first_cm.name as compatible_car_model, first_cm.name_ar as compatible_car_model_ar,
                first_cm.year_start as compatible_car_year_from, first_cm.year_end as compatible_car_year_to,
                cb.name as compatible_car_brand, cb.name_ar as compatible_car_brand_ar,
                jsonb_array_length(COALESCE(p.car_model_ids, '[]'::jsonb)) as compatible_car_models_count,
                COALESCE(variants.list, '[]'::jsonb) as available_variants
         FROM base
         JOIN products p ON p.id = base.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN LATERAL (
           SELECT cm.id, cm.name, cm.name_ar, cm.year_start, cm.year_end,
                  COALESCE(cm.car_brand_id, cm.brand_id) AS resolved_brand_id
           FROM car_models cm
           WHERE p.car_model_ids IS NOT NULL
             AND jsonb_array_length(p.car_model_ids) > 0
             AND cm.id = (p.car_model_ids->>0)::uuid
             AND cm.deleted_at IS NULL
           LIMIT 1
         ) first_cm ON TRUE
         LEFT JOIN car_brands cb ON first_cm.resolved_brand_id = cb.id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', s.id,
             'indicator', COALESCE(s.fitment_indicator,'صغير'),
             'price', s.price,
             'stock', s.stock_quantity
           ) ORDER BY (COALESCE(s.fitment_indicator,'صغير')='صغير') DESC,
                      COALESCE(s.fitment_indicator,'صغير')) AS list
           FROM products s
           WHERE s.sku = p.sku AND p.sku IS NOT NULL AND p.sku <> ''
             AND s.deleted_at IS NULL
             AND (s.hidden_status = FALSE OR s.hidden_status IS NULL)
         ) variants ON TRUE
         ORDER BY ${hasQ ? "base.rank DESC NULLS LAST, " : ""}base.created_at DESC LIMIT 50`,
        params,
      );
      return res.json({
        products: result.rows.map((p: any) => ({
          ...p,
          car_model_ids: p.car_model_ids || [],
          images: p.images || [],
          available_variants: p.available_variants || [],
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/products/:id", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT p.*,
                pb.id as pb_id, pb.name as product_brand_name, pb.name_ar as product_brand_name_ar,
                pb.logo as product_brand_logo, pb.country_of_origin as manufacturer_country,
                pb.country_of_origin_ar as manufacturer_country_ar,
                c.id as cat_id, c.name as category_name, c.name_ar as category_name_ar, c.icon as category_icon,
                s.id as supplier_id_ref, s.name as supplier_name,
                s.logo as supplier_profile_image, s.contact_phone as supplier_phone,
                s.email as supplier_email, s.contact_email as supplier_contact_email,
                s.website as supplier_website_url,
                s.country as supplier_address, s.notes as supplier_description,
                cs.id as cat_supp_id, cs.name as cat_supp_name,
                cs.logo as cat_supp_image, cs.contact_email as cat_supp_email,
                cs.website as cat_supp_website, cs.notes as cat_supp_desc
         FROM products p
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN suppliers s ON pb.supplier_id = s.id
         LEFT JOIN LATERAL (
           SELECT s2.id, s2.name, s2.logo, s2.contact_email, s2.website, s2.notes
           FROM suppliers s2
           WHERE p.category_id IS NOT NULL
             AND s2.linked_category_ids @> jsonb_build_array(p.category_id::text)
             AND s2.deleted_at IS NULL
           LIMIT 1
         ) cs ON true
         WHERE p.id = $1`,
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      const p = result.rows[0];
      p.car_model_ids = p.car_model_ids || [];
      p.images = p.images || [];
      p.price = parseFloat(p.price) || 0;
      p.sale_price = p.sale_price ? parseFloat(p.sale_price) : null;

      // Build nested objects
      p.product_brand = p.pb_id
        ? {
            id: p.pb_id,
            name: p.product_brand_name,
            name_ar: p.product_brand_name_ar,
            logo: p.product_brand_logo,
            country_of_origin: p.manufacturer_country,
            country_of_origin_ar: p.manufacturer_country_ar,
            supplier: p.supplier_id_ref
              ? {
                  id: p.supplier_id_ref,
                  name: p.supplier_name,
                  name_ar: p.supplier_name_ar,
                  profile_image: p.supplier_profile_image || null,
                  phone: p.supplier_phone || null,
                  email: p.supplier_email || p.supplier_contact_email || null,
                  contact_email:
                    p.supplier_contact_email || p.supplier_email || null,
                  website_url: p.supplier_website_url || null,
                  phone_numbers: p.supplier_phone_numbers || [],
                  address: p.supplier_address || null,
                  description: p.supplier_description || null,
                  description_ar: p.supplier_description_ar || null,
                }
              : null,
          }
        : null;
      p.supplier = p.product_brand?.supplier || null;
      // New: supplier linked to this product's category via linked_category_ids
      p.linked_supplier = p.cat_supp_id
        ? {
            id: p.cat_supp_id,
            name: p.cat_supp_name,
            profile_image: p.cat_supp_image || null,
            contact_email: p.cat_supp_email || null,
            website_url: p.cat_supp_website || null,
            description: p.cat_supp_desc || null,
          }
        : null;

      // Clean up supplier flat fields not removed later
      delete p.supplier_name;
      delete p.supplier_profile_image;
      delete p.supplier_phone;
      delete p.supplier_email;
      delete p.supplier_contact_email;
      delete p.supplier_website_url;
      delete p.supplier_address;
      delete p.supplier_description;
      delete p.cat_supp_id;
      delete p.cat_supp_name;
      delete p.cat_supp_image;
      delete p.cat_supp_email;
      delete p.cat_supp_website;
      delete p.cat_supp_desc;

      p.category = p.cat_id
        ? {
            id: p.cat_id,
            name: p.category_name,
            name_ar: p.category_name_ar,
            icon: p.category_icon,
          }
        : null;

      // Fetch car models for compatible cars display
      let car_models: any[] = [];
      if (p.car_model_ids && p.car_model_ids.length > 0) {
        const cmResult = await query(
          `SELECT cm.id, cm.name, cm.name_ar, cm.image_url, cm.year_start, cm.year_end,
                  cb.id as brand_id, cb.name as brand_name, cb.name_ar as brand_name_ar, cb.logo as brand_logo
           FROM car_models cm
           LEFT JOIN car_brands cb ON COALESCE(cm.car_brand_id, cm.brand_id) = cb.id
           WHERE cm.id::text IN (SELECT jsonb_array_elements_text($1::jsonb)) AND cm.deleted_at IS NULL`,
          [JSON.stringify(p.car_model_ids)],
        ).catch(() => ({ rows: [] }));
        car_models = cmResult.rows.map((m: any) => ({
          id: m.id,
          name: m.name,
          name_ar: m.name_ar,
          image_url: m.image_url,
          year_start: m.year_start,
          year_end: m.year_end,
          brand: m.brand_id
            ? {
                id: m.brand_id,
                name: m.brand_name,
                name_ar: m.brand_name_ar,
                logo: m.brand_logo,
              }
            : null,
        }));
      }
      p.car_models = car_models;

      // Sibling fitment variants (live + visible) for customer view
      try {
        if (p.sku) {
          const sib = await query(
            `SELECT id, COALESCE(fitment_indicator,'صغير') AS indicator,
                    price, stock_quantity AS stock
             FROM products
             WHERE sku=$1 AND deleted_at IS NULL
               AND (hidden_status = FALSE OR hidden_status IS NULL)
               AND COALESCE(stock_quantity, 0) > 0
             ORDER BY (COALESCE(fitment_indicator,'صغير')='صغير') DESC,
                      COALESCE(fitment_indicator,'صغير')`,
            [p.sku],
          );
          p.available_variants = sib.rows.map((r: any) => ({
            id: r.id,
            indicator: r.indicator,
            price: parseFloat(r.price) || 0,
            stock: parseInt(r.stock) || 0,
          }));
        } else {
          p.available_variants = [];
        }
      } catch {
        p.available_variants = [];
      }

      // Clean up flat fields
      delete p.pb_id;
      delete p.cat_id;
      delete p.product_brand_name;
      delete p.product_brand_name_ar;
      delete p.product_brand_logo;
      delete p.category_name;
      delete p.category_name_ar;
      delete p.category_icon;
      delete p.supplier_id_ref;
      delete p.manufacturer_country;
      delete p.manufacturer_country_ar;

      return res.json(p);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/products",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          price,
          sku,
          product_brand_id,
          category_id,
          image_url,
          images,
          car_model_ids,
          stock_quantity,
          hidden_status,
          fitment_indicator,
          is_tire,
          product_type,
          fitment_price_variants,
          fitment_stock_variants,
          ingredients,
          ingredients_ar,
          pairing_notes,
          pairing_notes_ar,
          nutrition,
        } = req.body;
        if (!name || !name_ar || price === undefined || !sku) {
          return res
            .status(400)
            .json({ detail: "name, name_ar, price, sku are required" });
        }

        const ALLOWED_PT = ["tire", "accessory", "exterior"];
        const ptInput =
          typeof product_type === "string"
            ? product_type.trim().toLowerCase()
            : null;
        const productType =
          ptInput && ALLOWED_PT.includes(ptInput) ? ptInput : null;
        // Keep is_tire in sync with product_type for backward-compat readers
        const isTireFinal =
          productType !== null
            ? productType === "tire"
            : is_tire === true || is_tire === "true";

        const DINING_SIZES = ["صغير", "وسط", "كبير", "كومبو", "عائلي"];
        const indicator = fitment_indicator ? String(fitment_indicator) : null;
        if (indicator && !DINING_SIZES.includes(indicator)) {
          return res
            .status(400)
            .json({ detail: `مؤشر الحجم غير صالح. القيم المسموحة: ${DINING_SIZES.join("، ")}` });
        }

        const ingredientsJson = normalizeIngredients(ingredients);
        const ingredientsArJson = normalizeIngredients(ingredients_ar);
        const nutritionJson = normalizeNutrition(nutrition);
        const pairingNotesVal =
          typeof pairing_notes === "string" && pairing_notes.trim().length > 0
            ? pairing_notes.trim()
            : null;
        const pairingNotesArVal =
          typeof pairing_notes_ar === "string" &&
          pairing_notes_ar.trim().length > 0
            ? pairing_notes_ar.trim()
            : null;

        const result = await query(
          `INSERT INTO products (id, name, name_ar, description, description_ar, price, sku, product_brand_id, category_id, image_url, images, car_model_ids, stock_quantity, hidden_status, added_by_admin_id, fitment_indicator, is_tire, product_type, fitment_price_variants, fitment_stock_variants, base_fitment_sku, ingredients, ingredients_ar, pairing_notes, pairing_notes_ar, nutrition)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
          [
            genId(),
            name,
            name_ar,
            description || null,
            description_ar || null,
            price,
            sku,
            product_brand_id || null,
            category_id || null,
            image_url || null,
            JSON.stringify(images || []),
            JSON.stringify(car_model_ids || []),
            stock_quantity || 0,
            hidden_status || false,
            (req as any).user?.id || null,
            indicator,
            isTireFinal,
            productType,
            JSON.stringify(fitment_price_variants || {}),
            JSON.stringify(fitment_stock_variants || {}),
            indicator && indicator !== "STD" ? sku : null,
            ingredientsJson,
            ingredientsArJson,
            pairingNotesVal,
            pairingNotesArVal,
            nutritionJson,
          ],
        );
        const product = result.rows[0];
        broadcastToAll({ type: "product_created", data: product });
        return res.json(product);
      } catch (err: any) {
        if (err.code === "23505")
          return res
            .status(400)
            .json({ detail: "هذا المؤشّر موجود بالفعل لنفس الـ SKU" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ── Shared stock-transition helper ────────────────────────────────────────
  // Used by both PUT /api/products/:id and PATCH /api/products/:id/stock so
  // notifications and broadcasts are identical regardless of which update path
  // triggered the stock change.
  async function handleStockTransition(
    productId: string,
    oldStock: number,
    newStock: number,
    productFields: {
      name: string;
      name_ar: string;
      sku: string | null;
      image_url: string | null;
      price: number | null;
      fitment_indicator: string | null;
    },
  ) {
    const wasInStock = oldStock > 0;
    if (newStock === oldStock) return; // no transition
    if (newStock !== 0 && !(newStock > 0 && oldStock === 0)) return; // not a boundary crossing

    let brandName: string | null = null;
    let compatibleCarModels: any[] = [];
    try {
      const enrich = await query(
        `SELECT pb.name AS product_brand_name,
                COALESCE(cars.list, '[]'::jsonb) AS compatible_car_models
           FROM products p
           LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
           LEFT JOIN LATERAL (
             SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar
             ) ORDER BY cm.name), '[]'::jsonb) AS list
             FROM (
               SELECT elem::uuid AS cm_id
               FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS elem
               LIMIT 3
             ) ids
             JOIN car_models cm ON cm.id = ids.cm_id
           ) cars ON TRUE
          WHERE p.id=$1`,
        [productId],
      );
      brandName = enrich.rows[0]?.product_brand_name || null;
      compatibleCarModels = enrich.rows[0]?.compatible_car_models || [];
    } catch {}

    const { name, name_ar, sku, image_url, price, fitment_indicator } = productFields;
    const stockNotifBase = {
      product_id: productId,
      sku: sku ?? null,
      name,
      name_ar,
      image_url: image_url || null,
      price: price != null ? Number(price) : null,
      fitment_indicator: fitment_indicator ?? null,
      product_brand_name: brandName,
      compatible_car_models: compatibleCarModels,
    };

    const admins = await query(
      "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
    );

    if (newStock === 0 && wasInStock) {
      const oosMeta = { ...stockNotifBase, kind: "out_of_stock", stock: 0 };
      for (const admin of admins.rows) {
        const notifId = genId();
        await query(
          "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'warning',$7)",
          [
            notifId, admin.id,
            "Out of Stock", "نفاد المخزون",
            `"${name}" is out of stock`,
            `نفد مخزون المنتج "${name_ar || name}"`,
            JSON.stringify(oosMeta),
          ],
        );
        broadcastToUser(admin.id, {
          type: "notification",
          data: {
            id: notifId, title: "نفاد المخزون",
            message: `نفد مخزون المنتج "${name_ar || name}"`,
            type: "warning", read: false,
            created_at: new Date().toISOString(), metadata: oosMeta,
          },
        });
      }
      broadcastToAll({ type: "product_stock_updated", data: { id: productId, stock_quantity: 0, name, name_ar } });
    } else if (newStock > 0 && oldStock === 0) {
      const restockMeta = { ...stockNotifBase, kind: "restock", stock: newStock };
      for (const admin of admins.rows) {
        const notifId = genId();
        await query(
          "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'success',$7)",
          [
            notifId, admin.id,
            "Stock Restocked", "تم تجديد المخزون",
            `"${name}" is back in stock (${newStock} units)`,
            `تم تجديد مخزون "${name_ar || name}" (${newStock} وحدة)`,
            JSON.stringify(restockMeta),
          ],
        );
        broadcastToUser(admin.id, {
          type: "notification",
          data: {
            id: notifId, title: "تم تجديد المخزون",
            message: `تم تجديد مخزون "${name_ar || name}" (${newStock} وحدة)`,
            type: "success", read: false,
            created_at: new Date().toISOString(), metadata: restockMeta,
          },
        });
      }
      broadcastToAll({ type: "product_stock_updated", data: { id: productId, stock_quantity: newStock, name, name_ar } });
    }
  }

  app.put(
    "/api/products/:id",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        // restaurant_user can only update stock_quantity — block full product edits
        if ((req as any).userRole === "restaurant_user") {
          if (req.body?.stock_quantity === undefined) {
            return res.status(403).json({ detail: "مديرو المطاعم يمكنهم تعديل المخزون فقط" });
          }
          // Check product belongs to one of their restaurants
          const productRow = await query(
            "SELECT car_model_ids FROM products WHERE id=$1 AND deleted_at IS NULL",
            [req.params.id],
          );
          if (productRow.rows.length === 0) return res.status(404).json({ detail: "Not found" });
          const userRestaurantIds = await getUserRestaurantIds((req as any).user.id);
          const productRestaurantIds: string[] = productRow.rows[0].car_model_ids ?? [];
          const hasAccess = productRestaurantIds.some((rid) => userRestaurantIds.includes(rid));
          if (!hasAccess) {
            return res.status(403).json({ detail: "ليس لديك صلاحية تعديل مخزون هذا المنتج" });
          }
          // Redirect to the dedicated stock endpoint logic inline
          const newStock = parseInt(String(req.body.stock_quantity), 10);
          if (isNaN(newStock) || newStock < 0) {
            return res.status(400).json({ detail: "stock_quantity must be a non-negative integer" });
          }
          // Fetch old stock + product fields for transition/history tracking
          const oldProductRow = await query(
            "SELECT stock_quantity, name, name_ar, sku, image_url, price, fitment_indicator FROM products WHERE id=$1 AND deleted_at IS NULL",
            [req.params.id],
          );
          if (oldProductRow.rows.length === 0) return res.status(404).json({ detail: "Not found" });
          const oldStockVal = parseInt(String(oldProductRow.rows[0].stock_quantity ?? "0"), 10);
          const r = await query(
            "UPDATE products SET stock_quantity=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
            [newStock, req.params.id],
          );
          if (r.rows.length === 0) return res.status(404).json({ detail: "Not found" });
          const updatedProduct = r.rows[0];
          broadcastToAll({ type: "stock_updated", data: { product_id: updatedProduct.id, stock_quantity: newStock } });
          // Run stock-transition notifications (same as PATCH /stock path)
          try {
            await handleStockTransition(updatedProduct.id, oldStockVal, newStock, {
              name: updatedProduct.name,
              name_ar: updatedProduct.name_ar,
              sku: updatedProduct.sku ?? null,
              image_url: updatedProduct.image_url ?? null,
              price: updatedProduct.price != null ? Number(updatedProduct.price) : null,
              fitment_indicator: updatedProduct.fitment_indicator ?? null,
            });
          } catch {}
          // Record in stock_history
          if (oldStockVal !== newStock) {
            const changedBy = (req as any).user?.id ?? null;
            const changedByName = (req as any).user?.name ?? null;
            try {
              await query(
                `INSERT INTO stock_history (product_id, old_quantity, new_quantity, changed_by, changed_by_name, source)
                 VALUES ($1, $2, $3, $4, $5, 'edit')`,
                [updatedProduct.id, oldStockVal, newStock, changedBy, changedByName],
              );
            } catch (histErr: any) {
              req.log.warn({ err: histErr, productId: updatedProduct.id }, '[StockHistory] Failed to insert stock_history row (restaurant_user PUT)');
            }
          }
          return res.json(updatedProduct);
        }

        const {
          name,
          name_ar,
          description,
          description_ar,
          price,
          sku,
          product_brand_id,
          category_id,
          image_url,
          images,
          car_model_ids,
          stock_quantity,
          hidden_status,
          fitment_indicator,
          is_tire,
          product_type,
          fitment_price_variants,
          fitment_stock_variants,
          ingredients,
          ingredients_ar,
          pairing_notes,
          pairing_notes_ar,
          nutrition,
        } = req.body;

        const ALLOWED_PT = ["tire", "accessory", "exterior"];
        const ptInput =
          typeof product_type === "string"
            ? product_type.trim().toLowerCase()
            : null;
        const productType =
          ptInput && ALLOWED_PT.includes(ptInput) ? ptInput : null;
        const isTireFinal =
          productType !== null
            ? productType === "tire"
            : is_tire === true || is_tire === "true";

        const DINING_SIZES_UPD = ["صغير", "وسط", "كبير", "كومبو", "عائلي"];
        const indicator = fitment_indicator ? String(fitment_indicator) : null;
        if (indicator && !DINING_SIZES_UPD.includes(indicator)) {
          return res
            .status(400)
            .json({ detail: `مؤشر الحجم غير صالح. القيم المسموحة: ${DINING_SIZES_UPD.join("، ")}` });
        }

        // Get old product to detect stock changes
        const oldProduct = await query(
          "SELECT stock_quantity FROM products WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        const oldStock = oldProduct.rows[0]?.stock_quantity ?? null;

        const ingredientsJson = normalizeIngredients(ingredients);
        const ingredientsArJson = normalizeIngredients(ingredients_ar);
        const nutritionJson = normalizeNutrition(nutrition);
        const pairingNotesVal =
          typeof pairing_notes === "string" && pairing_notes.trim().length > 0
            ? pairing_notes.trim()
            : null;
        const pairingNotesArVal =
          typeof pairing_notes_ar === "string" &&
          pairing_notes_ar.trim().length > 0
            ? pairing_notes_ar.trim()
            : null;

        const result = await query(
          `UPDATE products SET name=$1,name_ar=$2,description=$3,description_ar=$4,price=$5,sku=$6::text,product_brand_id=$7,category_id=$8,image_url=$9,images=$10,car_model_ids=$11,stock_quantity=$12,hidden_status=$13,
            fitment_indicator=$15::text, is_tire=$16, product_type=$19::text, fitment_price_variants=$17, fitment_stock_variants=$18,
            base_fitment_sku = CASE WHEN $15::text IS NOT NULL AND $15::text <> 'STD' THEN $6::text ELSE NULL::text END,
            ingredients=$20::jsonb, ingredients_ar=$21::jsonb,
            pairing_notes=$22, pairing_notes_ar=$23,
            nutrition=$24::jsonb,
            updated_at=NOW()
         WHERE id=$14 AND deleted_at IS NULL RETURNING *`,
          [
            name,
            name_ar,
            description || null,
            description_ar || null,
            price,
            sku,
            product_brand_id || null,
            category_id || null,
            image_url || null,
            JSON.stringify(images || []),
            JSON.stringify(car_model_ids || []),
            stock_quantity || 0,
            hidden_status || false,
            req.params.id,
            indicator,
            isTireFinal,
            JSON.stringify(fitment_price_variants || {}),
            JSON.stringify(fitment_stock_variants || {}),
            productType,
            ingredientsJson,
            ingredientsArJson,
            pairingNotesVal,
            pairingNotesArVal,
            nutritionJson,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const product = result.rows[0];

        // Broadcast product_updated to all clients
        broadcastToAll({ type: "product_updated", data: product });

        // Fire stock-transition notifications/broadcasts via shared helper
        const newStockVal = parseInt(String(stock_quantity ?? 0), 10);
        const oldStockVal = oldStock === null ? 0 : parseInt(String(oldStock), 10);
        try {
          await handleStockTransition(product.id, oldStockVal, newStockVal, {
            name,
            name_ar,
            sku: product.sku ?? null,
            image_url: product.image_url || null,
            price: product.price != null ? Number(product.price) : null,
            fitment_indicator: product.fitment_indicator ?? null,
          });
        } catch {}

        // Record change in stock_history
        if (oldStockVal !== newStockVal) {
          const changedBy = (req as any).user?.id ?? null;
          const changedByName = (req as any).user?.name ?? null;
          try {
            await query(
              `INSERT INTO stock_history (product_id, old_quantity, new_quantity, changed_by, changed_by_name, source)
               VALUES ($1, $2, $3, $4, $5, 'edit')`,
              [product.id, oldStockVal, newStockVal, changedBy, changedByName],
            );
          } catch (histErr: any) {
            req.log.warn({ err: histErr, productId: product.id }, '[StockHistory] Failed to insert stock_history row (edit)');
          }
        }

        return res.json(product);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/products/:id/stock-history",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        // restaurant_user: verify the product belongs to one of their restaurants
        if ((req as any).userRole === "restaurant_user") {
          const productRow = await query(
            "SELECT car_model_ids FROM products WHERE id=$1 AND deleted_at IS NULL",
            [req.params.id],
          );
          if (productRow.rows.length === 0) return res.status(404).json({ detail: "Not found" });
          const productRestaurantIds: string[] = productRow.rows[0].car_model_ids ?? [];
          const userRestaurantIds = await getUserRestaurantIds((req as any).user.id);
          const hasAccess = productRestaurantIds.some((rid) => userRestaurantIds.includes(rid));
          if (!hasAccess) {
            return res.status(403).json({ detail: "ليس لديك صلاحية عرض سجل مخزون هذا المنتج" });
          }
        }
        const paramsParsed = GetProductStockHistoryQueryParams.safeParse(req.query);
        if (!paramsParsed.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: paramsParsed.error.errors });
        }
        // `since` is an optional ISO date string to filter to a date window (e.g. last 30 days).
        // When omitted the endpoint returns the most-recent `limit` events with no date cap,
        // preserving backwards-compatible behaviour for existing callers.
        const { limit, since: sinceRaw } = paramsParsed.data;
        const sinceDate = sinceRaw ? new Date(sinceRaw) : null;
        const result = sinceDate
          ? await query(
              `SELECT sh.id, sh.old_quantity, sh.new_quantity, sh.source, sh.changed_at,
                      sh.changed_by_name, u.name AS changed_by_user_name
               FROM stock_history sh
               LEFT JOIN users u ON u.id = sh.changed_by
               WHERE sh.product_id = $1
                 AND sh.changed_at >= $2
               ORDER BY sh.changed_at DESC
               LIMIT $3`,
              [req.params.id, sinceDate.toISOString(), limit],
            )
          : await query(
              `SELECT sh.id, sh.old_quantity, sh.new_quantity, sh.source, sh.changed_at,
                      sh.changed_by_name, u.name AS changed_by_user_name
               FROM stock_history sh
               LEFT JOIN users u ON u.id = sh.changed_by
               WHERE sh.product_id = $1
               ORDER BY sh.changed_at DESC
               LIMIT $2`,
              [req.params.id, limit],
            );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/restaurants/:id/stock-history
  // Returns combined stock-change log for all products belonging to the restaurant.
  // Accessible by owner/partner/admin and by restaurant_user assigned to this restaurant.
  app.get(
    "/api/restaurants/:id/stock-history",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const restaurantId = String(req.params.id);

        // restaurant_user: verify they are assigned to this restaurant
        if ((req as any).userRole === "restaurant_user") {
          const userRestaurantIds = await getUserRestaurantIds((req as any).user.id);
          if (!userRestaurantIds.includes(restaurantId)) {
            return res.status(403).json({ detail: "ليس لديك صلاحية عرض سجل مخزون هذا المطعم" });
          }
        }

        const stockHistoryParams = GetRestaurantStockHistoryQueryParams.safeParse(req.query);
        if (!stockHistoryParams.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: stockHistoryParams.error.errors });
        }
        const { limit } = stockHistoryParams.data;
        const result = await query(
          `SELECT sh.id, sh.old_quantity, sh.new_quantity, sh.source, sh.changed_at,
                  sh.changed_by_name, u.name AS changed_by_user_name,
                  p.id AS product_id, p.name AS product_name, p.name_ar AS product_name_ar,
                  p.image_url AS product_image_url
           FROM stock_history sh
           JOIN products p ON p.id = sh.product_id
           LEFT JOIN users u ON u.id = sh.changed_by
           WHERE p.car_model_ids @> $1::jsonb
             AND p.deleted_at IS NULL
           ORDER BY sh.changed_at DESC
           LIMIT $2`,
          [JSON.stringify([restaurantId]), limit],
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/products/:id/stock",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const raw = req.body?.stock_quantity;
        const rawStr = String(raw ?? "").trim();
        const newStock = parseInt(rawStr, 10);
        if (isNaN(newStock) || newStock < 0 || String(newStock) !== rawStr) {
          return res.status(400).json({ detail: "stock_quantity must be a non-negative integer" });
        }
        // Capture old stock before update for transition detection
        const oldRow = await query(
          "SELECT stock_quantity, name, name_ar, sku, image_url, price, fitment_indicator, car_model_ids FROM products WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        if (oldRow.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });

        // restaurant_user: verify product belongs to one of their restaurants
        if ((req as any).userRole === "restaurant_user") {
          const userRestaurantIds = await getUserRestaurantIds((req as any).user.id);
          const productRestaurantIds: string[] = oldRow.rows[0].car_model_ids ?? [];
          const hasAccess = productRestaurantIds.some((rid) => userRestaurantIds.includes(rid));
          if (!hasAccess) {
            return res.status(403).json({ detail: "ليس لديك صلاحية تعديل مخزون هذا المنتج" });
          }
        }
        const oldStock = parseInt(oldRow.rows[0].stock_quantity ?? "0", 10);
        const { name, name_ar, sku, image_url, price, fitment_indicator } = oldRow.rows[0];

        const result = await query(
          "UPDATE products SET stock_quantity=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING id, name, name_ar, stock_quantity",
          [newStock, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const product = result.rows[0];

        // Fire stock-transition notifications/broadcasts via shared helper
        try {
          await handleStockTransition(product.id, oldStock, newStock, {
            name, name_ar,
            sku: sku ?? null,
            image_url: image_url || null,
            price: price != null ? Number(price) : null,
            fitment_indicator: fitment_indicator ?? null,
          });
        } catch {}

        // Record change in stock_history
        if (oldStock !== newStock) {
          const changedBy = (req as any).user?.id ?? null;
          const changedByName = (req as any).user?.name ?? null;
          try {
            await query(
              `INSERT INTO stock_history (product_id, old_quantity, new_quantity, changed_by, changed_by_name, source)
               VALUES ($1, $2, $3, $4, $5, 'restock')`,
              [product.id, oldStock, newStock, changedBy, changedByName],
            );
          } catch (histErr: any) {
            req.log.warn({ err: histErr, productId: product.id }, '[StockHistory] Failed to insert stock_history row (restock)');
          }
        }

        // Broadcast the confirmed stock value after every PATCH so all
        // connected owners see the current number in their notification-log
        // mini-cards in real time — even if the value did not change.
        broadcastToAll({
          type: 'stock_updated',
          data: { product_id: product.id, stock_quantity: newStock },
        });

        return res.json(product);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/products/:id/price",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { price } = req.body;
        const result = await query(
          "UPDATE products SET price=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [price, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const product = result.rows[0];
        broadcastToAll({
          type: "price_changed",
          data: {
            id: product.id,
            price,
            name: product.name,
            name_ar: product.name_ar,
          },
        });
        return res.json(product);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/products/:id/hidden",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { hidden_status } = req.body;
        const result = await query(
          "UPDATE products SET hidden_status=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [hidden_status, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Bulk-update price/stock for multiple variant rows in one call.
  // Each row is updated independently; per-row success/error is returned so
  // a partial failure does not abort the rest of the batch.
  app.patch(
    "/api/products/bulk-variants",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const updates = Array.isArray(req.body?.updates)
          ? req.body.updates
          : null;
        if (!updates || updates.length === 0) {
          return res
            .status(400)
            .json({ detail: "updates must be a non-empty array" });
        }

        // Pre-fetch restaurant_user's allowed restaurant IDs once
        const isRestaurantUser = (req as any).userRole === "restaurant_user";
        const userRestaurantIds: string[] = isRestaurantUser
          ? await getUserRestaurantIds((req as any).user.id)
          : [];

        const results: Array<{
          id: string;
          success: boolean;
          error?: string;
          product?: any;
        }> = [];
        for (const u of updates) {
          const id = u && typeof u.id === "string" ? u.id : null;
          if (!id) {
            results.push({ id: String(u?.id ?? ""), success: false, error: "Missing id" });
            continue;
          }

          // restaurant_user: check per-product restaurant ownership
          if (isRestaurantUser) {
            const productRow = await query(
              "SELECT car_model_ids FROM products WHERE id=$1 AND deleted_at IS NULL",
              [id],
            );
            if (productRow.rows.length === 0) {
              results.push({ id, success: false, error: "Not found" });
              continue;
            }
            const productRestaurantIds: string[] = productRow.rows[0].car_model_ids ?? [];
            const hasAccess = productRestaurantIds.some((rid) => userRestaurantIds.includes(rid));
            if (!hasAccess) {
              results.push({ id, success: false, error: "ليس لديك صلاحية تعديل مخزون هذا المنتج" });
              continue;
            }
            // restaurant_user can only update stock — ignore price changes
            const stock = parseInt(String(u.stock_quantity ?? u.stock ?? "0"), 10);
            if (Number.isNaN(stock) || stock < 0) {
              results.push({ id, success: false, error: "Invalid stock" });
              continue;
            }
            try {
              const r = await query(
                "UPDATE products SET stock_quantity=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
                [stock, id],
              );
              if (r.rows.length === 0) {
                results.push({ id, success: false, error: "Not found" });
              } else {
                const product = r.rows[0];
                broadcastToAll({ type: "stock_updated", data: { product_id: product.id, stock_quantity: stock } });
                results.push({ id, success: true, product });
              }
            } catch (err: any) {
              results.push({ id, success: false, error: err.message });
            }
            continue;
          }

          const price = Number(u.price);
          const stock = parseInt(
            String(u.stock_quantity ?? u.stock ?? "0"),
            10,
          );
          if (Number.isNaN(price) || price < 0) {
            results.push({ id, success: false, error: "Invalid price" });
            continue;
          }
          if (Number.isNaN(stock) || stock < 0) {
            results.push({ id, success: false, error: "Invalid stock" });
            continue;
          }
          try {
            const r = await query(
              "UPDATE products SET price=$1, stock_quantity=$2, updated_at=NOW() WHERE id=$3 AND deleted_at IS NULL RETURNING *",
              [price, stock, id],
            );
            if (r.rows.length === 0) {
              results.push({ id, success: false, error: "Not found" });
            } else {
              const product = r.rows[0];
              broadcastToAll({ type: "product_updated", data: product });
              results.push({ id, success: true, product });
            }
          } catch (err: any) {
            results.push({ id, success: false, error: err.message });
          }
        }
        return res.json({ results });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/products/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE products SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CART ====================

  app.get(
    "/api/cart",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        // Pull all SKU siblings via LATERAL so the cart UI can render an
        // always-on chip strip showing every available fitment for the SKU
        // (even ones the user hasn't added yet → they appear with qty 0 and
        // the user can tap + to add). Mirrors the LATERAL pattern in
        // /api/products so the chip price for each indicator is the real
        // per-fitment value, not a clone of the parent product price.
        const result = await query(
          `SELECT ci.*, p.name, p.name_ar, p.price,
                COALESCE(p.image_url, (
                  SELECT s2.image_url FROM products s2
                  WHERE s2.sku = p.sku AND s2.deleted_at IS NULL
                    AND s2.image_url IS NOT NULL
                    AND p.sku IS NOT NULL AND p.sku <> ''
                  ORDER BY (COALESCE(s2.fitment_indicator,'صغير')='صغير') DESC
                  LIMIT 1
                )) AS image_url,
                p.sku, p.stock_quantity,
                COALESCE(p.fitment_indicator,'صغير') AS product_fitment_indicator,
                p.is_tire,
                p.product_type,
                pb.name as product_brand_name,
                COALESCE(variants.list, '[]'::jsonb) as available_variants,
                COALESCE(cars.list, '[]'::jsonb) as compatible_car_models
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(jsonb_build_object(
             'id', s.id,
             'indicator', COALESCE(s.fitment_indicator,'صغير'),
             'price', s.price,
             'stock', s.stock_quantity
           ) ORDER BY (COALESCE(s.fitment_indicator,'صغير')='صغير') DESC,
                      COALESCE(s.fitment_indicator,'صغير')) AS list
           FROM products s
           WHERE s.sku = p.sku
             AND p.sku IS NOT NULL AND p.sku <> ''
             AND s.deleted_at IS NULL
             AND (s.hidden_status = FALSE OR s.hidden_status IS NULL)
         ) variants ON TRUE
         LEFT JOIN LATERAL (
           -- Resolve up to 3 compatible car-model names so the cart card
           -- can render the "🚗 model · model" strip without an extra
           -- round-trip. Capped at 3 to keep payload small; client shows
           -- "+N more" when the underlying car_model_ids array is longer.
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar
           ) ORDER BY cm.name), '[]'::jsonb) AS list
           FROM (
             SELECT elem::uuid AS cm_id
             FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS elem
             LIMIT 3
           ) ids
           JOIN car_models cm ON cm.id = ids.cm_id
         ) cars ON TRUE
         WHERE ci.user_id = $1
         ORDER BY ci.created_at`,
          [userId],
        );

        const items = result.rows.map((item: any) => ({
          ...item,
          fitment_indicator: item.fitment_indicator || item.product_fitment_indicator,
          available_variants: item.available_variants || [],
          compatible_car_models: item.compatible_car_models || [],
          product: {
            id: item.product_id,
            name: item.name,
            name_ar: item.name_ar,
            price: item.price,
            image_url: item.image_url,
            sku: item.sku,
            stock_quantity: item.stock_quantity,
            fitment_indicator: item.product_fitment_indicator,
            is_tire: item.is_tire,
            product_type: item.product_type,
            product_brand_name: item.product_brand_name,
            available_variants: item.available_variants || [],
            compatible_car_models: item.compatible_car_models || [],
          },
        }));

        const total = items.reduce((sum: number, item: any) => {
          const price = item.final_unit_price || item.product.price;
          return sum + price * item.quantity;
        }, 0);

        // Check subscriber single-restaurant discount eligibility
        const cartUserEmail = (req as any).user?.email || '';
        const cartUserPhone = (req as any).user?.phone || '';
        const cartSubResult = await query(
          `SELECT id FROM subscribers WHERE (email=$1 OR phone=$2) AND deleted_at IS NULL LIMIT 1`,
          [cartUserEmail, cartUserPhone],
        );
        const cartIsSubscriber = cartSubResult.rows.length > 0;
        let cartSubscriberEligible = false;
        if (cartIsSubscriber && result.rows.length > 0) {
          const cartProductIds = result.rows.map((r: any) => r.product_id);
          const cartRestResult = await query(
            `SELECT
               COUNT(DISTINCT CASE WHEN car_model_ids IS NOT NULL AND jsonb_array_length(car_model_ids) > 0 THEN (car_model_ids->>0) END) AS distinct_restaurants,
               COUNT(*) AS total_products,
               COUNT(CASE WHEN car_model_ids IS NOT NULL AND jsonb_array_length(car_model_ids) > 0 THEN 1 END) AS mapped_products
             FROM products
            WHERE id = ANY($1::uuid[])`,
            [cartProductIds],
          );
          if (cartRestResult.rows.length > 0) {
            const { distinct_restaurants, total_products, mapped_products } = cartRestResult.rows[0];
            cartSubscriberEligible =
              Number(distinct_restaurants) === 1 &&
              Number(total_products) > 0 &&
              Number(mapped_products) === Number(total_products);
          }
        }
        const cartEffectiveShipping = cartSubscriberEligible ? 25.0 : SHIPPING_COST;

        return res.json({
          items,
          total,
          shipping_cost: cartEffectiveShipping,
          subscriber_discount_eligible: cartSubscriberEligible,
          subscriber_shipping_cost: 25.0,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/cart/add",
    cartAddLimiter,
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const {
          product_id,
          quantity = 1,
          bundle_group_id,
          bundle_offer_id,
          bundle_discount_percentage,
          fitment_indicator,
        } = req.body;

        const productResult = await query(
          "SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL",
          [product_id],
        );
        if (productResult.rows.length === 0)
          return res.status(404).json({ detail: "Product not found" });

        const indicator = fitment_indicator
          ? String(fitment_indicator).toUpperCase()
          : null;

        // ── Variant resolution ───────────────────────────────────────────────
        // The catalog deduplicates per SKU and prefers the STD row, so list
        // surfaces (home / category / car / search) all surface STD's id even
        // when the user picks another fitment chip. If the loaded row has no
        // JSONB `fitment_stock_variants` entry for the requested indicator —
        // i.e. the row-per-variant model — re-route the cart insert to the
        // sibling row that actually owns the indicator. Without this the
        // STD-out-of-stock scenario blocks adding any in-stock variant.
        let prod = productResult.rows[0];
        let effectiveProductId: string = product_id;
        if (indicator && !bundle_group_id && prod.sku) {
          const prodInd = String(prod.fitment_indicator ?? "STD").toUpperCase();
          const fsv = prod.fitment_stock_variants;
          const fsvHasIndicator =
            fsv &&
            typeof fsv === "object" &&
            !Array.isArray(fsv) &&
            Object.prototype.hasOwnProperty.call(fsv, indicator);
          if (prodInd !== indicator && !fsvHasIndicator) {
            const sib = await query(
              `SELECT * FROM products
               WHERE sku=$1 AND deleted_at IS NULL
                 AND COALESCE(fitment_indicator,'صغير') = $2
               LIMIT 1`,
              [prod.sku, indicator],
            );
            if (sib.rows.length > 0) {
              prod = sib.rows[0];
              effectiveProductId = prod.id;
            }
          }
        }
        // ────────────────────────────────────────────────────────────────────

        // ── Stock validation ─────────────────────────────────────────────────
        // Skip for bundle items (bundles bypass individual stock checks).
        if (!bundle_group_id) {
          let availableStock: number;
          const fsv = prod.fitment_stock_variants;
          const fsvHasIndicator =
            fsv &&
            typeof fsv === "object" &&
            !Array.isArray(fsv) &&
            indicator &&
            Object.prototype.hasOwnProperty.call(fsv, indicator);
          if (fsvHasIndicator) {
            availableStock = Number(
              (fsv as Record<string, any>)[indicator as string] ?? 0,
            );
          } else {
            availableStock = Number(prod.stock_quantity ?? 0);
          }
          if (availableStock <= 0) {
            return res.status(409).json({
              detail: "out_of_stock",
              stock: 0,
              message: "هذا المنتج نفذ من المخزون",
            });
          }
          // Check how many are already in the cart for this fitment
          const existingCheck = await query(
            `SELECT quantity FROM cart_items
             WHERE user_id=$1 AND product_id=$2
               AND COALESCE(fitment_indicator,'') = COALESCE($3,'')`,
            [userId, effectiveProductId, indicator],
          );
          const currentCartQty = existingCheck.rows.length > 0
            ? Number(existingCheck.rows[0].quantity)
            : 0;
          const requestedTotal = currentCartQty + Number(quantity);
          if (requestedTotal > availableStock) {
            const allowed = availableStock - currentCartQty;
            if (allowed <= 0) {
              return res.status(409).json({
                detail: "stock_exceeded",
                stock: availableStock,
                in_cart: currentCartQty,
                message: `لا يمكن إضافة أكثر من ${availableStock} من هذا المنتج`,
              });
            }
            // Silently cap the added quantity to what's available
            (req.body as any).quantity = allowed;
          }
        }
        // ────────────────────────────────────────────────────────────────────

        const existing = await query(
          `SELECT id, quantity FROM cart_items
           WHERE user_id=$1 AND product_id=$2
             AND (bundle_group_id IS NULL OR bundle_group_id=$3)
             AND COALESCE(fitment_indicator,'') = COALESCE($4,'')`,
          [userId, effectiveProductId, bundle_group_id || null, indicator],
        );

        const finalQty = Number((req.body as any).quantity ?? quantity);
        if (existing.rows.length > 0 && !bundle_group_id) {
          const newQty = existing.rows[0].quantity + finalQty;
          await query(
            "UPDATE cart_items SET quantity=$1,updated_at=NOW() WHERE id=$2",
            [newQty, existing.rows[0].id],
          );
        } else {
          await query(
            "INSERT INTO cart_items (id,user_id,product_id,quantity,bundle_group_id,bundle_offer_id,bundle_discount_percentage,fitment_indicator) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              genId(),
              userId,
              effectiveProductId,
              finalQty,
              bundle_group_id || null,
              bundle_offer_id || null,
              bundle_discount_percentage || null,
              indicator,
            ],
          );
        }

        return res.json({ message: "Added to cart", quantity: finalQty });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/cart/add-enhanced",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const {
          product_id,
          quantity = 1,
          original_unit_price,
          final_unit_price,
          discount_details,
          bundle_group_id,
          added_by_admin_id,
        } = req.body;

        await query(
          `INSERT INTO cart_items (id,user_id,product_id,quantity,original_unit_price,final_unit_price,discount_details,bundle_group_id,added_by_admin_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            genId(),
            userId,
            product_id,
            quantity,
            original_unit_price || null,
            final_unit_price || null,
            discount_details ? JSON.stringify(discount_details) : null,
            bundle_group_id || null,
            added_by_admin_id || null,
          ],
        );

        return res.json({ message: "Added to cart" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/cart/update",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id, quantity, fitment_indicator } = req.body;
        // Scope mutations by (user_id, product_id, fitment_indicator) so
        // different fitment variants of the same product remain independent.
        // When indicator is null/undefined we match rows whose
        // fitment_indicator IS NULL; otherwise we match exactly.
        const indicator =
          fitment_indicator === undefined ? null : fitment_indicator;

        // ── Stock cap validation (only when increasing quantity) ─────────────
        if (quantity > 0) {
          const prodRes = await query(
            `SELECT stock_quantity, fitment_stock_variants FROM products WHERE id=$1 AND deleted_at IS NULL`,
            [product_id],
          );
          if (prodRes.rows.length > 0) {
            const prod = prodRes.rows[0];
            let availableStock: number;
            const fsv = prod.fitment_stock_variants;
            const fsvHasIndicator =
              fsv &&
              typeof fsv === "object" &&
              !Array.isArray(fsv) &&
              indicator &&
              Object.prototype.hasOwnProperty.call(fsv, indicator);
            if (fsvHasIndicator) {
              availableStock = Number(
                (fsv as Record<string, any>)[indicator as string] ?? 0,
              );
            } else {
              availableStock = Number(prod.stock_quantity ?? 0);
            }
            if (availableStock > 0 && quantity > availableStock) {
              return res.status(409).json({
                detail: "stock_exceeded",
                stock: availableStock,
                capped: availableStock,
                message: `لا يمكن تجاوز الكمية المتاحة (${availableStock})`,
              });
            }
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        if (quantity <= 0) {
          if (indicator === null) {
            await query(
              "DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2 AND fitment_indicator IS NULL",
              [userId, product_id],
            );
          } else {
            await query(
              "DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2 AND fitment_indicator = $3",
              [userId, product_id, indicator],
            );
          }
        } else if (indicator === null) {
          await query(
            "UPDATE cart_items SET quantity=$1,updated_at=NOW() WHERE user_id=$2 AND product_id=$3 AND fitment_indicator IS NULL",
            [quantity, userId, product_id],
          );
        } else {
          await query(
            "UPDATE cart_items SET quantity=$1,updated_at=NOW() WHERE user_id=$2 AND product_id=$3 AND fitment_indicator = $4",
            [quantity, userId, product_id, indicator],
          );
        }

        return res.json({ message: "Cart updated" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/cart/remove/:productId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const bodyIndicator =
          req.body && Object.prototype.hasOwnProperty.call(req.body, "fitment_indicator")
            ? req.body.fitment_indicator
            : undefined;
        const queryIndicator = req.query.fitment_indicator as string | undefined;
        const indicator =
          bodyIndicator !== undefined
            ? bodyIndicator
            : queryIndicator !== undefined
              ? queryIndicator
              : null;
        if (indicator === null) {
          await query(
            "DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2 AND fitment_indicator IS NULL",
            [userId, req.params.productId],
          );
        } else {
          await query(
            "DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2 AND fitment_indicator = $3",
            [userId, req.params.productId, indicator],
          );
        }
        return res.json({ message: "Removed from cart" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/cart/void-bundle/:bundleGroupId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query(
          "DELETE FROM cart_items WHERE user_id=$1 AND bundle_group_id=$2",
          [userId, req.params.bundleGroupId],
        );
        return res.json({ message: "Bundle voided" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/cart/clear",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query("DELETE FROM cart_items WHERE user_id=$1", [userId]);
        return res.json({ message: "Cart cleared" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/cart/validate-stock",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const cartResult = await query(
          `SELECT ci.quantity, p.stock_quantity, p.name, p.name_ar FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         WHERE ci.user_id=$1`,
          [userId],
        );

        const invalid = cartResult.rows.filter(
          (item: any) => item.quantity > item.stock_quantity,
        );
        if (invalid.length > 0) {
          return res.status(400).json({ valid: false, invalid_items: invalid });
        }
        return res.json({ valid: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ORDERS ====================

  app.get(
    "/api/orders",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);

        // Restaurant managers: return orders that contain at least one product
        // from their assigned restaurants. Items are filtered to only those
        // belonging to the manager's restaurants, and the total is recomputed
        // so that cross-restaurant order data is never exposed.
        if (role === "restaurant_user") {
          const restaurantIds = await getUserRestaurantIds(user.id);
          if (restaurantIds.length === 0) {
            return res.json([]);
          }
          // $1 = manager's restaurant ID array.
          // A LATERAL join computes matched items once per order to avoid
          // repeating the predicate three times.  The match condition checks
          // the embedded compatible_car_models snapshot first (primary path)
          // and falls back to the products table for legacy items that were
          // stored before the snapshot field was added.
          const result = await query(
            `SELECT
               o.id, o.order_number, o.status,
               o.customer_name, o.customer_email, o.customer_phone,
               o.user_name, o.user_email, o.user_phone,
               o.notes, o.payment_method,
               o.street_address, o.city, o.state,
               o.delivery_latitude, o.delivery_longitude, o.delivery_address,
               o.created_at, o.updated_at, o.user_id,
               COALESCE(m.matched_items, '[]'::jsonb) AS items,
               m.matched_total                         AS total_amount
             FROM orders o
             CROSS JOIN LATERAL (
               SELECT
                 jsonb_agg(ie ORDER BY (ie->>'unit_price')::numeric DESC) AS matched_items,
                 COALESCE(
                   SUM((ie->>'unit_price')::numeric * (ie->>'quantity')::int), 0
                 )::float AS matched_total
               FROM jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) ie
               WHERE (
                 -- Primary: use embedded compatible_car_models snapshot
                 EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(ie->'compatible_car_models') cm
                   WHERE cm->>'id' = ANY($1::text[])
                 )
                 OR (
                   -- Fallback: snapshot missing/empty — look up via products table
                   COALESCE(jsonb_array_length(ie->'compatible_car_models'), 0) = 0
                   AND EXISTS (
                     SELECT 1 FROM products p
                     WHERE p.id::text = (ie->>'product_id')
                       AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
                       AND EXISTS (
                         SELECT 1 FROM jsonb_array_elements(p.car_model_ids) cid
                         WHERE cid #>> '{}' = ANY($1::text[])
                       )
                   )
                 )
               )
             ) m
             WHERE o.deleted_at IS NULL
               AND COALESCE(jsonb_array_length(m.matched_items), 0) > 0
             ORDER BY o.created_at DESC`,
            [restaurantIds],
          );
          return res.json(
            result.rows.map((o: any) => ({ ...o, items: o.items || [] })),
          );
        }

        // Regular users: return only their own placed orders.
        const result = await query(
          "SELECT * FROM orders WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
          [user.id],
        );
        return res.json(
          result.rows.map((o: any) => ({ ...o, items: o.items || [] })),
        );
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/admin",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        // NOTE: orders table does NOT have a `discount_amount` column —
        // referencing it caused this endpoint to 500 and the owner panel
        // to render an empty list. We expose checkout fields (first_name,
        // last_name, email, phone) directly so the row always shows the
        // actual customer info even when the user account was deleted.
        const result = await query(
          `SELECT o.*,
                  o.total_amount::float           AS total,
                  (COALESCE(o.shipping_cost,0))::float AS shipping,
                  o.email                          AS customer_email,
                  o.phone                          AS customer_phone,
                  TRIM(CONCAT(COALESCE(o.first_name,''), ' ', COALESCE(o.last_name,''))) AS customer_name,
                  u.name                           AS user_name,
                  u.email                          AS user_email
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.id
            WHERE o.deleted_at IS NULL
            ORDER BY o.created_at DESC`,
        );
        const orders = result.rows.map((o: any) => ({
          ...o,
          items: Array.isArray(o.items) ? o.items : (o.items || []),
          customer_name: o.customer_name?.trim() || null,
        }));
        return res.json({ orders });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/admin/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT o.*, u.name as user_name, u.email as user_email
         FROM orders o LEFT JOIN users u ON o.user_id = u.id
         WHERE o.id=$1`,
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const o = result.rows[0];
        o.items = o.items || [];
        return res.json(o);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/my/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT * FROM orders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
          [req.params.id, userId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Order not found" });
        }
        const order = result.rows[0];
        order.items = order.items || [];
        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/orders/my/:id/cancel",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT * FROM orders WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
          [req.params.id, userId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Order not found" });
        }
        const order = result.rows[0];
        const nonCancelableStatuses = ["shipped", "delivered", "cancelled"];
        if (nonCancelableStatuses.includes(order.status)) {
          return res
            .status(400)
            .json({ detail: "Cannot cancel order in current status" });
        }
        // Restore stock before marking cancelled
        const orderId = Array.isArray(req.params.id)
          ? req.params.id[0]
          : req.params.id;
        await restoreStockForOrder(orderId);
        await query(
          "UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1 AND user_id=$2",
          [orderId, userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/orders/pending-count/:userId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT COUNT(*) FROM orders WHERE user_id=$1 AND status='pending' AND deleted_at IS NULL",
          [req.params.userId],
        );
        return res.json({ count: parseInt(result.rows[0].count) });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/orders",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const {
          first_name,
          last_name,
          email,
          phone,
          street_address,
          city,
          state,
          country = "Egypt",
          delivery_instructions,
          payment_method = "cash_on_delivery",
          notes,
          delivery_latitude,
          delivery_longitude,
          delivery_address,
        } = req.body;
        // Coerce lat/lng to numbers (or null) so PG accepts them on the NUMERIC columns.
        const _deliveryLat =
          delivery_latitude != null && Number.isFinite(Number(delivery_latitude))
            ? Number(delivery_latitude)
            : null;
        const _deliveryLng =
          delivery_longitude != null && Number.isFinite(Number(delivery_longitude))
            ? Number(delivery_longitude)
            : null;
        const _deliveryAddr =
          typeof delivery_address === "string" && delivery_address.trim()
            ? delivery_address.trim().slice(0, 1000)
            : null;

        // ── Atomic order placement ──────────────────────────────────────────
        // Everything that READS or MUTATES persistent state (cart read +
        // lock, order INSERT, stock decrements, cart DELETE) runs inside a
        // single transaction so that either ALL succeed or NONE do.
        // The cart is read with `FOR UPDATE OF ci` so a second concurrent
        // /api/orders call for the same user blocks until this transaction
        // commits — at which point the cart will be empty and the second
        // call returns 400 "Cart is empty".  This closes the double-submit
        // race even when stock is sufficient for both.
        // If any item's stock can no longer satisfy the requested quantity
        // (genuine race with stock-changing endpoints), we throw
        // INSUFFICIENT_STOCK and the whole transaction is rolled back.
        const stockDeltas: Array<{
          productId: string;
          fitmentIndicator: string | null;
          oldStock: number;
          newStock: number;
        }> = [];
        let order: any;
        let orderNum: string;
        try {
          const txResult = await withTransaction(async (q) => {
            // Cart read inside transaction WITH ROW LOCK on cart_items.
            // Including fitment JSONB so we can resolve variant price/stock
            // for either the row-per-variant or single-row+JSONB model.
            const cartResult = await q(
              `SELECT ci.*, p.name, p.name_ar, p.price, p.image_url, p.sku,
                      p.fitment_price_variants, p.fitment_stock_variants,
                      pb.name AS product_brand_name,
                      COALESCE(cars.list, '[]'::jsonb) AS compatible_car_models
                 FROM cart_items ci
                 JOIN products p ON ci.product_id = p.id
                 LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
                 LEFT JOIN LATERAL (
                   -- Snapshot up to 3 compatible car models into the order
                   -- items JSON so the order detail UI can render the
                   -- unified product card without an N+1 query.
                   SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar
                   ) ORDER BY cm.name), '[]'::jsonb) AS list
                   FROM (
                     SELECT elem::uuid AS cm_id
                     FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS elem
                     LIMIT 3
                   ) ids
                   JOIN car_models cm ON cm.id = ids.cm_id
                 ) cars ON TRUE
                WHERE ci.user_id=$1
                FOR UPDATE OF ci`,
              [userId],
            );

            if (cartResult.rows.length === 0) {
              const e: any = new Error("EMPTY_CART");
              e.code = "EMPTY_CART";
              throw e;
            }

            const items = cartResult.rows.map((item: any) => {
              // Fitment-aware unit price resolution:
              //   1. final_unit_price (admin override / bundle) wins.
              //   2. else fitment_price_variants[indicator] when present.
              //   3. else products.price (row-level / STD price).
              const indicator = item.fitment_indicator || null;
              const variantPriceMap = item.fitment_price_variants || {};
              const variantPrice =
                indicator && variantPriceMap && variantPriceMap[indicator] != null
                  ? Number(variantPriceMap[indicator])
                  : null;
              const resolvedUnitPrice =
                item.final_unit_price ?? variantPrice ?? item.price;
              const resolvedOriginalPrice =
                item.original_unit_price ?? variantPrice ?? item.price;
              return {
                product_id: item.product_id,
                name: item.name,
                name_ar: item.name_ar,
                sku: item.sku,
                image_url: item.image_url,
                quantity: item.quantity,
                unit_price: resolvedUnitPrice,
                original_unit_price: resolvedOriginalPrice,
                discount_details: item.discount_details,
                bundle_group_id: item.bundle_group_id,
                bundle_offer_id: item.bundle_offer_id || null,
                bundle_discount_percentage:
                  item.bundle_discount_percentage || null,
                fitment_indicator: indicator,
                // Snapshot brand + first 3 compatible car models so the
                // order-detail UI can render the unified product card
                // without re-querying products (which may be edited or
                // deleted later — the snapshot preserves what the
                // customer actually saw at checkout time).
                product_brand_name: item.product_brand_name || null,
                compatible_car_models: item.compatible_car_models || [],
                _has_jsonb_stock:
                  !!(item.fitment_stock_variants && indicator &&
                     Object.prototype.hasOwnProperty.call(
                       item.fitment_stock_variants, indicator)) as
                    | boolean
                    | undefined,
              };
            });

            const subtotal = items.reduce((sum: number, item: any) => {
              let price = item.unit_price;
              if (!price || price === item.original_unit_price) {
                if (item.bundle_discount_percentage) {
                  price =
                    item.original_unit_price *
                    (1 - item.bundle_discount_percentage / 100);
                  item.unit_price = price;
                }
              }
              return sum + price * item.quantity;
            }, 0);

            // Subscriber single-restaurant discount: 25 EGP instead of 50
            const checkoutUserEmail = (req as any).user?.email || '';
            const checkoutUserPhone = (req as any).user?.phone || '';
            const checkoutSubResult = await q(
              `SELECT id FROM subscribers WHERE (email=$1 OR phone=$2) AND deleted_at IS NULL LIMIT 1`,
              [checkoutUserEmail, checkoutUserPhone],
            );
            const checkoutIsSubscriber = checkoutSubResult.rows.length > 0;
            let checkoutSubscriberDiscount = false;
            if (checkoutIsSubscriber) {
              const checkoutProductIds = cartResult.rows.map((r: any) => r.product_id);
              const checkoutRestResult = await q(
                `SELECT
                   COUNT(DISTINCT CASE WHEN car_model_ids IS NOT NULL AND jsonb_array_length(car_model_ids) > 0 THEN (car_model_ids->>0) END) AS distinct_restaurants,
                   COUNT(*) AS total_products,
                   COUNT(CASE WHEN car_model_ids IS NOT NULL AND jsonb_array_length(car_model_ids) > 0 THEN 1 END) AS mapped_products
                 FROM products
                WHERE id = ANY($1::uuid[])`,
                [checkoutProductIds],
              );
              if (checkoutRestResult.rows.length > 0) {
                const { distinct_restaurants, total_products, mapped_products } = checkoutRestResult.rows[0];
                checkoutSubscriberDiscount =
                  Number(distinct_restaurants) === 1 &&
                  Number(total_products) > 0 &&
                  Number(mapped_products) === Number(total_products);
              }
            }
            const appliedShippingCost = checkoutSubscriberDiscount ? 25.0 : SHIPPING_COST;
            const total = subtotal + appliedShippingCost;

            const seqRes = await q(
              "SELECT LPAD(nextval('order_number_seq')::text, 7, '0') as num",
            );
            const _orderNum = seqRes.rows[0].num;

            const insertRes = await q(
              `INSERT INTO orders (id,user_id,order_number,first_name,last_name,email,phone,street_address,city,state,country,delivery_instructions,payment_method,notes,status,total_amount,shipping_cost,items,delivery_latitude,delivery_longitude,delivery_address)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending',$15,$16,$17,$18,$19,$20) RETURNING *`,
              [
                genId(),
                userId,
                _orderNum,
                first_name,
                last_name,
                email || (req as any).user.email,
                phone,
                street_address,
                city,
                state,
                country,
                delivery_instructions || null,
                payment_method,
                checkoutSubscriberDiscount
                  ? [notes, 'delivery_discount:subscriber_single_restaurant'].filter(Boolean).join(' | ') || null
                  : notes || null,
                total,
                appliedShippingCost,
                JSON.stringify(items),
                _deliveryLat,
                _deliveryLng,
                _deliveryAddr,
              ],
            );

            // Decrease stock — fitment-aware (see legacy comments above).
            // If a row's WHERE clause prevents the UPDATE (insufficient stock),
            // r.rows.length === 0 → throw to roll back the entire transaction.
            for (const item of items) {
              let r: any;
              if (item._has_jsonb_stock && item.fitment_indicator) {
                r = await q(
                  `UPDATE products
                     SET fitment_stock_variants = jsonb_set(
                       COALESCE(fitment_stock_variants, '{}'::jsonb),
                       ARRAY[$3::text],
                       to_jsonb(GREATEST(
                         0,
                         COALESCE((fitment_stock_variants->>$3)::int, 0) - $1::int
                       )),
                       true
                     )
                   WHERE id = $2
                     AND COALESCE((fitment_stock_variants->>$3)::int, 0) >= $1
                   RETURNING COALESCE((fitment_stock_variants->>$3)::int, 0) AS new_stock`,
                  [item.quantity, item.product_id, item.fitment_indicator],
                );
              } else {
                r = await q(
                  `UPDATE products SET stock_quantity = stock_quantity - $1
                     WHERE id = $2 AND stock_quantity >= $1
                     RETURNING stock_quantity AS new_stock`,
                  [item.quantity, item.product_id],
                );
              }
              if (!r.rows.length) {
                const e: any = new Error("INSUFFICIENT_STOCK");
                e.code = "INSUFFICIENT_STOCK";
                e.product_id = item.product_id;
                e.fitment_indicator = item.fitment_indicator || null;
                e.requested = item.quantity;
                throw e;
              }
              const newStock = Number(r.rows[0].new_stock) || 0;
              stockDeltas.push({
                productId: item.product_id,
                fitmentIndicator: item.fitment_indicator || null,
                oldStock: newStock + Number(item.quantity || 0),
                newStock,
              });
              // strip internal helper before persistence
              delete item._has_jsonb_stock;
            }

            // Clear cart only after stock decrement succeeded.
            await q("DELETE FROM cart_items WHERE user_id=$1", [userId]);

            return { order: insertRes.rows[0], orderNum: _orderNum };
          });
          order = txResult.order;
          orderNum = txResult.orderNum;
        } catch (txErr: any) {
          if (txErr?.code === "EMPTY_CART") {
            return res.status(400).json({ detail: "Cart is empty" });
          }
          if (txErr?.code === "INSUFFICIENT_STOCK") {
            return res.status(409).json({
              detail: "insufficient_stock",
              product_id: txErr.product_id,
              fitment_indicator: txErr.fitment_indicator,
              requested: txErr.requested,
              message:
                "تم تحديث المخزون أثناء معالجة طلبك — يرجى مراجعة السلة وإعادة المحاولة",
            });
          }
          throw txErr;
        }

        // Fire low-stock & out-of-stock alerts AFTER successful commit
        // (non-blocking).  Doing this inside the transaction would risk
        // notifying about an order that was rolled back.
        for (const d of stockDeltas) {
          maybeFireLowStockAlert(d).catch((err: any) =>
            clog.error("[lowStockAlert] dispatch failed:", err?.message || err),
          );
          if (d.newStock === 0) {
            maybeFireOutOfStockAlert({
              productId: d.productId,
              fitmentIndicator: d.fitmentIndicator,
            }).catch((err: any) =>
              clog.error("[outOfStockAlert] dispatch failed:", err?.message || err),
            );
          }
        }

        order.items = order.items || [];

        // Notify admins via DB and WebSocket
        try {
          // Fetch customer avatar
          const userRow = await query("SELECT picture FROM users WHERE id=$1", [
            userId,
          ]);
          const avatarUrl = userRow.rows[0]?.picture || null;
          const customerMeta = {
            kind: "new_order",
            order_id: order.id,
            order_number: orderNum,
            customer_name: `${first_name} ${last_name}`,
            customer_email: email || (req as any).user.email,
            customer_phone: phone,
            customer_avatar: avatarUrl,
          };

          const adminUsers = await query(
            "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
          );
          for (const adminUser of adminUsers.rows) {
            const notifId = genId();
            await query(
              "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'success',$7)",
              [
                notifId,
                adminUser.id,
                "New Order",
                "طلب جديد",
                `New order #${orderNum} received`,
                `تم استلام طلب جديد #${orderNum}`,
                JSON.stringify(customerMeta),
              ],
            );
            broadcastToUser(adminUser.id, {
              type: "notification",
              data: {
                id: notifId,
                title: "طلب جديد",
                message: `تم استلام طلب جديد #${orderNum}`,
                type: "success",
                read: false,
                created_at: new Date().toISOString(),
                metadata: customerMeta,
              },
            });
          }
          // Extract the primary restaurant_id from the order items so
          // analytics screens can filter toasts to only their restaurant.
          const _firstItem = Array.isArray(order.items) ? order.items[0] : null;
          const _restaurantId =
            _firstItem?.compatible_car_models?.[0]?.id ?? null;

          // Notify restaurant_users (managers) for this order's restaurant.
          // These users are NOT in the admins/owners tables so they are missed
          // by the admin loop above. Skip any user already notified there to
          // avoid duplicate notifications for owner-managers.
          if (_restaurantId) {
            try {
              const alreadyNotifiedIds = new Set<string>(
                (adminUsers.rows as Array<{ id: string }>).map((r) => r.id),
              );
              const ruRows = await query(
                `SELECT DISTINCT u.id
                   FROM users u
                   JOIN restaurant_users ru ON ru.user_id = u.id
                  WHERE ru.restaurant_id = $1`,
                [_restaurantId],
              );
              for (const ruUser of ruRows.rows) {
                if (alreadyNotifiedIds.has(ruUser.id)) continue;
                const rnId = genId();
                await query(
                  "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'success',$7)",
                  [
                    rnId, ruUser.id,
                    "New Order", "طلب جديد",
                    `New order #${orderNum} received`,
                    `تم استلام طلب جديد #${orderNum}`,
                    JSON.stringify(customerMeta),
                  ],
                );
                broadcastToUser(ruUser.id, {
                  type: "notification",
                  data: {
                    id: rnId,
                    title: "طلب جديد",
                    message: `تم استلام طلب جديد #${orderNum}`,
                    type: "success",
                    read: false,
                    created_at: new Date().toISOString(),
                    metadata: customerMeta,
                  },
                });
              }
            } catch (ruErr: unknown) {
              req.log.warn(
                { err: ruErr instanceof Error ? ruErr.message : String(ruErr) },
                "[notification] Failed to notify restaurant_users for new order",
              );
            }
          }

          broadcastToAll({
            type: "order_created",
            data: {
              id: order.id,
              order_number: orderNum,
              user_id: order.user_id,
              total_amount: order.total_amount,
              restaurant_id: _restaurantId,
            },
          });

          // Dispatch Expo push notifications when a new order arrives.
          // Recipients:
          //   1. Restaurant staff (restaurant_users) assigned to that restaurant
          //   2. Owners and partners — they oversee all restaurants and benefit
          //      from push alerts when the app is backgrounded
          if (_restaurantId) {
            (async () => {
              try {
                interface TokenRow { token: string; user_id: string }
                // Staff assigned to this specific restaurant
                const staffRows = await query(
                  `SELECT DISTINCT ept.token, ept.user_id
                   FROM expo_push_tokens ept
                   JOIN restaurant_users rua ON rua.user_id = ept.user_id
                   WHERE rua.restaurant_id = $1`,
                  [_restaurantId],
                );
                // Owners (from the owners table) and partners
                const privilegedRows = await query(
                  `SELECT DISTINCT ept.token, ept.user_id
                   FROM expo_push_tokens ept
                   JOIN users u ON u.id = ept.user_id
                   WHERE u.email IN (
                     SELECT email FROM owners WHERE deleted_at IS NULL
                     UNION
                     SELECT email FROM partners WHERE deleted_at IS NULL
                   )`,
                );
                const allRows: TokenRow[] = [
                  ...(staffRows.rows as TokenRow[]),
                  ...(privilegedRows.rows as TokenRow[]),
                ].filter((r) => r.token.startsWith("ExponentPushToken["));
                // Deduplicate by token (in case an owner also has a restaurant_user record)
                const seenTokens = new Set<string>();
                const dedupedRows = allRows.filter((r) => {
                  if (seenTokens.has(r.token)) return false;
                  seenTokens.add(r.token);
                  return true;
                });
                const uniqueTokens = dedupedRows.map((r) => r.token);
                const uniqueUserIds = [...new Set(dedupedRows.map((r) => r.user_id).filter(Boolean))];
                if (uniqueTokens.length === 0) return;
                // Count pending orders for this restaurant so the push badge
                // reflects how many unreviewed orders are waiting.
                // Orders are linked to a restaurant via their items JSONB array:
                // each item carries a product_id whose products.car_model_ids
                // array contains the restaurant's UUID.
                let pendingBadge = 1;
                try {
                  const pendingRes = await query(
                    `SELECT COUNT(DISTINCT o.id) AS cnt
                     FROM orders o
                     WHERE o.status = 'pending'
                       AND o.deleted_at IS NULL
                       AND EXISTS (
                         SELECT 1
                         FROM jsonb_array_elements(o.items) ie
                         JOIN products p ON p.id::text = (ie->>'product_id')
                         WHERE p.car_model_ids @> jsonb_build_array($1::text)
                           AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
                       )`,
                    [_restaurantId],
                  );
                  const parsed = parseInt((pendingRes.rows[0] as { cnt: string }).cnt, 10);
                  if (!isNaN(parsed) && parsed > 0) pendingBadge = parsed;
                } catch (badgeErr: unknown) {
                  clog.warn("[push dispatch] Badge count query failed, defaulting to 1", badgeErr instanceof Error ? badgeErr.message : String(badgeErr));
                }
                // Fetch language preference for every recipient so the OS-level
                // push notification (lock screen / notification shade) is shown
                // in each user's preferred language.
                const recipientLangMap = new Map<string, "en" | "ar">();
                try {
                  if (uniqueUserIds.length > 0) {
                    const langRes = await query(
                      `SELECT id, preferred_language FROM users WHERE id = ANY($1)`,
                      [uniqueUserIds],
                    );
                    for (const row of langRes.rows as { id: string; preferred_language: string }[]) {
                      recipientLangMap.set(row.id, row.preferred_language === "en" ? "en" : "ar");
                    }
                  }
                } catch (_langErr: unknown) {
                  clog.warn("[push dispatch] Language preference lookup failed, defaulting to Arabic", _langErr instanceof Error ? _langErr.message : String(_langErr));
                }
                const messages = dedupedRows.map((r) => {
                  const lang = recipientLangMap.get(r.user_id) ?? "ar";
                  const title = lang === "ar" ? "طلب جديد" : "New Order";
                  const body = lang === "ar"
                    ? `طلب جديد رقم #${orderNum} — ${Number(order.total_amount).toFixed(2)} ج.م`
                    : `New order #${orderNum} — EGP ${Number(order.total_amount).toFixed(2)}`;
                  return {
                    to: r.token,
                    sound: "default",
                    title,
                    body,
                    data: { order_id: order.id, order_number: orderNum, restaurant_id: _restaurantId },
                    priority: "high",
                    channelId: "orders",
                    badge: pendingBadge,
                  };
                });
                // Log the push dispatch for the notification history log — store both language variants
                query(
                  `INSERT INTO push_notification_log
                     (event_type, title, body, title_en, title_ar, body_en, body_ar, payload, recipient_user_ids, recipient_count)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                  [
                    "new_order",
                    "طلب جديد",
                    `طلب جديد رقم #${orderNum} — ${Number(order.total_amount).toFixed(2)} ج.م`,
                    "New Order",
                    "طلب جديد",
                    `New order #${orderNum} — EGP ${Number(order.total_amount).toFixed(2)}`,
                    `طلب جديد رقم #${orderNum} — ${Number(order.total_amount).toFixed(2)} ج.م`,
                    JSON.stringify({ order_id: order.id, order_number: orderNum, restaurant_id: _restaurantId }),
                    JSON.stringify(uniqueUserIds),
                    uniqueTokens.length,
                  ],
                ).catch((logErr: unknown) => {
                  clog.warn("[push dispatch] Failed to write notification log", logErr instanceof Error ? logErr.message : String(logErr));
                });
                // Fire-and-forget — push failure must never fail the order response
                fetch("https://exp.host/--/api/v2/push/send", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                  },
                  body: JSON.stringify(messages),
                }).then(async (pushRes) => {
                  if (!pushRes.ok) {
                    const body = await pushRes.text().catch(() => "(unreadable)");
                    clog.warn("[push dispatch] Expo push API HTTP error", { status: pushRes.status, body: body.slice(0, 200) });
                  } else {
                    clog.info("[push dispatch] Expo push sent", { recipients: uniqueTokens.length, order_number: orderNum });
                  }
                }).catch((fetchErr: unknown) => {
                  clog.warn("[push dispatch] Expo push API network error", fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
                });
              } catch (pushTokenErr: unknown) {
                clog.warn("[push dispatch] Failed to query push tokens for order", pushTokenErr instanceof Error ? pushTokenErr.message : String(pushTokenErr));
              }
            })();
          }
        } catch (pushErr: unknown) {
          clog.warn("[push dispatch] Outer push dispatch error", pushErr instanceof Error ? pushErr.message : String(pushErr));
        }

        // PostHog: track order placed
        try {
          captureEvent(userId, "order_placed", {
            order_id: order.id,
            order_number: orderNum,
            total_amount: order.total_amount,
            item_count: Array.isArray(order.items) ? order.items.length : 0,
            payment_method: order.payment_method,
          });
        } catch {}

        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/orders/admin-assisted",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { customer_id, items, shipping_address, phone, notes } = req.body;

        const subtotal = items.reduce(
          (sum: number, item: any) =>
            sum +
            (item.final_unit_price || item.original_unit_price || 0) *
              item.quantity,
          0,
        );
        const total = subtotal + SHIPPING_COST;
        const seqRes2 = await query(
          "SELECT LPAD(nextval('order_number_seq')::text, 7, '0') as num",
        );
        const orderNum = seqRes2.rows[0].num;

        const result = await query(
          `INSERT INTO orders (id,user_id,order_number,street_address,phone,notes,status,total_amount,shipping_cost,items)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9) RETURNING *`,
          [
            genId(),
            customer_id,
            orderNum,
            shipping_address,
            phone,
            notes || null,
            total,
            SHIPPING_COST,
            JSON.stringify(items),
          ],
        );

        const order = result.rows[0];
        order.items = order.items || [];

        // PostHog: track admin-assisted order placed
        try {
          captureEvent(customer_id, "order_placed", {
            order_id: order.id,
            order_number: orderNum,
            total_amount: order.total_amount,
            item_count: items.length,
            source: "admin_assisted",
          });
        } catch {}

        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/orders/:id/status",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { status } = req.query as { status: string };
        if (!Object.values(OrderStatus).includes(status as OrderStatus)) {
          return res.status(400).json({ detail: `Invalid status. Must be one of: ${Object.values(OrderStatus).join(", ")}` });
        }
        // Fetch current order status so we can detect cancelled transitions
        const currentRes = await query(
          "SELECT status FROM orders WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        if (currentRes.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const previousStatus = currentRes.rows[0].status;

        // Restore stock when transitioning TO 'cancelled' from a non-cancelled state
        if (status === "cancelled" && previousStatus !== "cancelled") {
          const orderId = Array.isArray(req.params.id)
            ? req.params.id[0]
            : req.params.id;
          await restoreStockForOrder(orderId);
        }

        const result = await query(
          "UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [status, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const order = result.rows[0];

        // Notify the order owner via DB + WebSocket
        try {
          const statusLabels: Record<string, { en: string; ar: string }> = {
            pending: { en: "Order received", ar: "تم استلام طلبك" },
            preparing: { en: "Order being prepared", ar: "جاري تحضير طلبك" },
            shipped: { en: "Order shipped", ar: "تم شحن طلبك" },
            out_for_delivery: {
              en: "Out for delivery",
              ar: "الطلب في الطريق إليك",
            },
            delivered: { en: "Order delivered", ar: "تم توصيل طلبك" },
            cancelled: { en: "Order cancelled", ar: "تم إلغاء طلبك" },
          };
          const label = statusLabels[status] || {
            en: `Status: ${status}`,
            ar: `الحالة: ${status}`,
          };
          const orderNum = order.order_number || order.id?.slice(-8);

          // Fetch customer avatar and language preference for rich notification
          const userRow = await query("SELECT picture, preferred_language FROM users WHERE id=$1", [
            order.user_id,
          ]);
          const customerAvatar = userRow.rows[0]?.picture || null;
          const customerLang: "en" | "ar" =
            userRow.rows[0]?.preferred_language === "en" ? "en" : "ar";
          const adminUser = (req as any).user;
          const adminName = adminUser?.name || adminUser?.email || "Admin";

          const orderMeta = {
            kind: "order_updated",
            order_id: order.id,
            order_number: orderNum,
            new_status: status,
            customer_name:
              `${order.first_name || ""} ${order.last_name || ""}`.trim(),
            customer_email: order.email,
            customer_phone: order.phone,
            customer_avatar: customerAvatar,
            admin_name: adminName,
          };

          const notifId = genId();
          await query(
            "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
            [
              notifId,
              order.user_id,
              `Order #${orderNum}`,
              `طلب #${orderNum}`,
              label.en,
              label.ar,
              JSON.stringify(orderMeta),
            ],
          );
          broadcastToUser(order.user_id, {
            type: "notification",
            data: {
              id: notifId,
              title: customerLang === "ar" ? `طلب #${orderNum}` : `Order #${orderNum}`,
              message: label[customerLang],
              type: "info",
              read: false,
              created_at: new Date().toISOString(),
              metadata: orderMeta,
            },
          });
          broadcastToAll({
            type: "order_updated",
            data: { ...order, user_id: order.user_id },
          });
          broadcastToAll({
            type: "order_status_changed",
            data: {
              order_id: order.id,
              order_number: orderNum,
              new_status: status,
              previous_status: previousStatus,
              restaurant_id: order.restaurant_id || null,
            },
          });

          // Log the status change to push_notification_log so the customer's
          // app can fetch and replay it on cold start / foreground resume
          // (the "missed push-log notifications" recovery path). Store both
          // language variants so the owner log can display either.
          query(
            `INSERT INTO push_notification_log
               (event_type, title, body, title_en, title_ar, body_en, body_ar, payload, recipient_user_ids, recipient_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
            [
              "order_updated",
              customerLang === "ar" ? `طلب #${orderNum}` : `Order #${orderNum}`,
              label[customerLang],
              `Order #${orderNum}`,
              `طلب #${orderNum}`,
              label.en,
              label.ar,
              JSON.stringify({
                order_id: order.id,
                order_number: orderNum,
                new_status: status,
                previous_status: previousStatus,
                user_id: order.user_id,
              }),
              JSON.stringify([order.user_id]),
            ],
          ).catch(() => {/* best-effort */});

          // Send Expo push notification to the customer (fire-and-forget)
          // Uses the same bilingual message strings defined in pushNotificationService.ts
          // so the wording is consistent between in-app and push contexts.
          (async () => {
            try {
              // Mirrors pushNotificationService.sendOrderStatusNotification() strings exactly
              const pushStatusMessages: Record<string, { en: string; ar: string }> = {
                pending:          { en: "Your order has been received and is being processed", ar: "تم استلام طلبك وجاري معالجته" },
                preparing:        { en: "Your order is being prepared",                        ar: "جاري تحضير طلبك" },
                shipped:          { en: "Your order has been shipped",                         ar: "تم شحن طلبك" },
                out_for_delivery: { en: "Your order is out for delivery",                      ar: "طلبك في الطريق إليك" },
                delivered:        { en: "Your order has been delivered",                       ar: "تم توصيل طلبك" },
                cancelled:        { en: "Your order has been cancelled",                       ar: "تم إلغاء طلبك" },
              };
              const pushMsg = pushStatusMessages[status] ?? {
                en: `Order ${orderNum} status: ${status}`,
                ar: `حالة الطلب ${orderNum}: ${status}`,
              };

              // Reuse the language already resolved above from the user row query
              const lang: "en" | "ar" = customerLang;

              interface TokenRow { token: string }
              const tokenRes = await query(
                "SELECT token FROM expo_push_tokens WHERE user_id=$1",
                [order.user_id],
              );
              // Accept any non-empty token — Expo tokens may be ExponentPushToken[...] or bare UUIDs
              const customerTokens = (tokenRes.rows as TokenRow[])
                .map((r) => r.token)
                .filter(Boolean);
              if (customerTokens.length === 0) return;

              const pushMessages = customerTokens.map((token: string) => ({
                to: token,
                sound: "default",
                title: lang === "ar" ? `طلب #${orderNum}` : `Order #${orderNum}`,
                body: pushMsg[lang],
                data: {
                  type: "order_status",
                  order_id: order.id,
                  order_number: orderNum,
                  status,
                },
                priority: "high",
                channelId: "orders",
              }));

              fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json",
                  "Accept-Encoding": "gzip, deflate",
                },
                body: JSON.stringify(pushMessages),
              }).then(async (pushRes) => {
                if (!pushRes.ok) {
                  const body = await pushRes.text().catch(() => "(unreadable)");
                  req.log.warn({ status: pushRes.status, body: body.slice(0, 200) }, "[push status] Expo push API HTTP error");
                } else {
                  req.log.info({ order_number: orderNum, new_status: status, recipients: customerTokens.length }, "[push status] Order status push sent to customer");
                }
              }).catch((fetchErr: unknown) => {
                req.log.warn({ err: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) }, "[push status] Expo push API network error");
              });
            } catch (pushErr: unknown) {
              req.log.warn({ err: pushErr instanceof Error ? pushErr.message : String(pushErr) }, "[push status] Failed to send status push notification");
            }
          })();
        } catch {}

        return res.json(order);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/orders/:id/discount",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { discount } = req.body;
        const result = await query(
          "UPDATE orders SET discount_amount=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [discount, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/orders/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const orderRes = await query(
          "SELECT id, items, status FROM orders WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        if (orderRes.rows.length === 0) {
          return res.status(404).json({ detail: "Order not found" });
        }
        const order = orderRes.rows[0];
        const items: Array<{ product_id: string; quantity: number }> =
          typeof order.items === "string"
            ? JSON.parse(order.items)
            : order.items || [];

        await query("UPDATE orders SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);

        if (items.length > 0 && order.status !== "cancelled") {
          for (const item of items) {
            if (item.product_id && item.quantity > 0) {
              await query(
                "UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id=$2 AND deleted_at IS NULL",
                [item.quantity, item.product_id],
              );
            }
          }
        }

        return res.json({
          message: "Deleted",
          stock_restored: items.length > 0,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== FAVORITES ====================

  app.get(
    "/api/favorites",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          `SELECT f.*, p.name, p.name_ar, p.price, p.image_url, p.sku,
                p.stock_quantity, p.car_model_ids, p.fitment_indicator,
                p.product_brand_id,
                pb.name as product_brand_name,
                pb.name_ar as product_brand_name_ar,
                COALESCE(cars.list, '[]'::jsonb) as compatible_car_models
         FROM favorites f
         JOIN products p ON f.product_id = p.id
         LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
         LEFT JOIN LATERAL (
           -- Same compatible car models LATERAL as /api/cart so the
           -- favorites grid card can show the "🚗 model · model" strip.
           SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar
           ) ORDER BY cm.name), '[]'::jsonb) AS list
           FROM (
             SELECT elem::uuid AS cm_id
             FROM jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS elem
             LIMIT 3
           ) ids
           JOIN car_models cm ON cm.id = ids.cm_id
         ) cars ON TRUE
         WHERE f.user_id=$1 ORDER BY f.created_at DESC`,
          [userId],
        );
        // Wrap into a `product` sub-object so the mobile favorites tab can
        // read `item.product.compatible_car_models` consistently with the
        // cart payload while keeping legacy top-level fields for older
        // consumers (FavoritesTab.tsx already checks both shapes).
        const rows = result.rows.map((r: any) => ({
          ...r,
          compatible_car_models: r.compatible_car_models || [],
          product: {
            id: r.product_id,
            name: r.name,
            name_ar: r.name_ar,
            price: r.price,
            image_url: r.image_url,
            sku: r.sku,
            stock_quantity: r.stock_quantity,
            car_model_ids: r.car_model_ids,
            fitment_indicator: r.fitment_indicator,
            product_brand_id: r.product_brand_id,
            product_brand_name: r.product_brand_name,
            product_brand_name_ar: r.product_brand_name_ar,
            compatible_car_models: r.compatible_car_models || [],
          },
        }));
        return res.json(rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/favorites/check/:productId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT id FROM favorites WHERE user_id=$1 AND product_id=$2",
          [userId, req.params.productId],
        );
        return res.json({ is_favorite: result.rows.length > 0 });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/favorites/toggle",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id } = req.body;
        const existing = await query(
          "SELECT id FROM favorites WHERE user_id=$1 AND product_id=$2",
          [userId, product_id],
        );
        if (existing.rows.length > 0) {
          await query(
            "DELETE FROM favorites WHERE user_id=$1 AND product_id=$2",
            [userId, product_id],
          );
          return res.json({ is_favorite: false });
        } else {
          await query(
            "INSERT INTO favorites (id,user_id,product_id) VALUES ($1,$2,$3)",
            [genId(), userId, product_id],
          );
          return res.json({ is_favorite: true });
        }
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/favorites",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id } = req.body;

        try {
          await query(
            "INSERT INTO favorites (id,user_id,product_id) VALUES ($1,$2,$3)",
            [genId(), userId, product_id],
          );
        } catch (e: any) {
          if (e.code !== "23505") throw e;
        }

        return res.json({ is_favorite: true, message: "Added to favorites" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/favorites/:productId",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        await query(
          "DELETE FROM favorites WHERE user_id=$1 AND product_id=$2",
          [userId, req.params.productId],
        );
        return res.json({
          is_favorite: false,
          message: "Removed from favorites",
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ============================================================
  // SUBSCRIPTION REQUESTS ROUTES
  // ============================================================

  // GET /api/subscription-requests — Admin/Owner: list all (optionally filter by ?email=); User: list own
  app.get(
    "/api/subscription-requests",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        let rows;
        if (["owner", "admin"].includes(role)) {
          const filterEmail = req.query.email as string | undefined;
          if (filterEmail) {
            rows = await query(
              `SELECT * FROM subscription_requests WHERE email=$1 ORDER BY created_at DESC`,
              [filterEmail],
            );
          } else {
            rows = await query(
              `SELECT * FROM subscription_requests ORDER BY created_at DESC`,
            );
          }
        } else {
          rows = await query(
            `SELECT * FROM subscription_requests WHERE email=$1 ORDER BY created_at DESC`,
            [user.email],
          );
        }
        return res.json(rows.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /api/subscription-requests — Any authenticated user submits a request
  app.post(
    "/api/subscription-requests",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const {
          customer_name,
          email,
          phone,
          governorate,
          village,
          address,
          car_model,
          business_type,
          request_type,
          notes,
        } = req.body;
        const result = await query(
          `INSERT INTO subscription_requests
          (id, customer_name, email, phone, governorate, village, detailed_address, car_model_name, business_type, request_type, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
         RETURNING *`,
          [
            genId(),
            customer_name || user.name || user.username || "",
            email || user.email || "",
            phone || "",
            governorate || "",
            village || "",
            address || "",
            car_model || "",
            business_type || "",
            request_type || "subscription",
            notes || "",
          ],
        );
        return res.status(201).json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/subscription-requests/:id — Admin/Owner: approve or reject
  app.patch(
    "/api/subscription-requests/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const { status } = req.body;
        if (!["approved", "rejected", "pending"].includes(status)) {
          return res.status(400).json({ detail: "Invalid status" });
        }
        const result = await query(
          `UPDATE subscription_requests
         SET status=$1, reviewed_by=$2, reviewed_at=NOW()
         WHERE id=$3
         RETURNING *`,
          [status, user.id, req.params.id],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Not found" });
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/subscription-requests/:id/approve",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }

        // 1. Load the request (without changing its status yet)
        const loadRes = await query(
          `SELECT * FROM subscription_requests WHERE id=$1`,
          [req.params.id],
        );
        if (loadRes.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const subscriptionReq = loadRes.rows[0];

        if (!subscriptionReq.email && !subscriptionReq.phone) {
          return res.status(400).json({
            detail:
              "Subscription request has no email or phone — cannot create subscriber",
          });
        }

        const email: string | null = subscriptionReq.email || null;
        const phone: string | null = subscriptionReq.phone || null;
        const name =
          subscriptionReq.customer_name || email || phone || "Subscriber";
        const subType = subscriptionReq.request_type || "monthly";

        // 2. Atomically: lock candidate subscriber row, upsert it, mark
        //    the request approved — all in a single transaction so a
        //    failure never leaves the request approved without a subscriber.
        let subscriberRow: any = null;
        let finalReq: any = subscriptionReq;
        try {
          await withTransaction(async (q) => {
            // Lock the conflicting subscriber row(s) to serialize concurrent
            // approvals matching the same identity.
            const existing = await q(
              `SELECT * FROM subscribers
               WHERE deleted_at IS NULL
                 AND (
                   ($1::text IS NOT NULL AND email = $1) OR
                   ($2::text IS NOT NULL AND phone = $2)
                 )
               ORDER BY created_at ASC
               LIMIT 1
               FOR UPDATE`,
              [email, phone],
            );

            if (existing.rows.length > 0) {
              const upd = await q(
                `UPDATE subscribers SET
                   email             = COALESCE($1, email),
                   phone             = COALESCE($2, phone),
                   name              = $3,
                   subscription_type = $4,
                   updated_at        = NOW(),
                   deleted_at        = NULL
                 WHERE id=$5 RETURNING *`,
                [email, phone, name, subType, existing.rows[0].id],
              );
              subscriberRow = upd.rows[0];
            } else {
              const ins = await q(
                `INSERT INTO subscribers (id, email, name, phone, subscription_type)
                 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                [genId(), email, name, phone, subType],
              );
              subscriberRow = ins.rows[0];
            }

            // Mark the request approved within the same transaction.
            const reqResult = await q(
              `UPDATE subscription_requests
               SET status='approved', reviewed_by=$1, reviewed_at=NOW()
               WHERE id=$2 RETURNING *`,
              [user.id, req.params.id],
            );
            finalReq = reqResult.rows[0] || subscriptionReq;
          });
        } catch (e: any) {
          clog.error(
            "[approve subscription] transaction failed:",
            e,
          );
          return res.status(500).json({
            detail: `Failed to approve subscription: ${e.message || "unknown error"}`,
          });
        }

        // 3. Best-effort: copy contact info to matching user profile (non-fatal,
        //    runs after the transaction so it never blocks approval).
        if (email) {
          await query(
            `UPDATE users SET
               name  = CASE WHEN $1 != '' THEN $1 ELSE name  END,
               phone = CASE WHEN $2 != '' THEN $2 ELSE phone END,
               updated_at = NOW()
             WHERE email = $3`,
            [
              subscriptionReq.customer_name || "",
              phone || "",
              email,
            ],
          ).catch(() => {});
        } else if (phone) {
          await query(
            `UPDATE users SET
               name  = CASE WHEN $1 != '' THEN $1 ELSE name END,
               updated_at = NOW()
             WHERE phone = $2 AND deleted_at IS NULL`,
            [subscriptionReq.customer_name || "", phone],
          ).catch(() => {});
        }

        return res.json({ ...finalReq, subscriber: subscriberRow });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/subscription-requests/:id/reject",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          `UPDATE subscription_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2 RETURNING *`,
          [user.id, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // DELETE /api/subscription-requests/:id — Admin/Owner: delete a request + revoke subscriber
  app.delete(
    "/api/subscription-requests/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        if (!["owner", "admin"].includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const reqRes = await query(
          `SELECT * FROM subscription_requests WHERE id=$1`,
          [req.params.id],
        );
        const subReq = reqRes.rows[0];
        let revokedUserId: string | null = null;
        if (subReq) {
          if (subReq.email) {
            await query(
              `UPDATE subscribers SET deleted_at=NOW() WHERE email=$1 AND deleted_at IS NULL`,
              [subReq.email],
            );
            // Find the user account associated with this email
            const uRes = await query(
              `SELECT id FROM users WHERE email=$1 AND deleted_at IS NULL LIMIT 1`,
              [subReq.email],
            );
            if (uRes.rows[0]) revokedUserId = uRes.rows[0].id;
          }
          if (subReq.phone && !revokedUserId) {
            await query(
              `UPDATE subscribers SET deleted_at=NOW() WHERE phone=$1 AND deleted_at IS NULL`,
              [subReq.phone],
            );
            const uRes = await query(
              `SELECT id FROM users WHERE phone=$1 AND deleted_at IS NULL LIMIT 1`,
              [subReq.phone],
            );
            if (uRes.rows[0]) revokedUserId = uRes.rows[0].id;
          }
        }
        await query(`DELETE FROM subscription_requests WHERE id=$1`, [
          req.params.id,
        ]);
        // Broadcast to the customer's device so it resets subscription status immediately
        if (revokedUserId) {
          broadcastToUser(revokedUserId, {
            type: "subscription_revoked",
            data: { status: "none" },
          });
        }
        return res.json({
          success: true,
          was_approved: subReq?.status === "approved",
          revoked_user_id: revokedUserId,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== OWNERS ====================

  app.get(
    "/api/owners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM owners WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/owners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone } = req.body;
        if (!email || !name)
          return res.status(400).json({ detail: "email and name required" });
        const result = await query(
          "INSERT INTO owners (id,email,name,phone) VALUES ($1,$2,$3,$4) RETURNING *",
          [genId(), email.toLowerCase(), name, phone || null],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "Owner already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/owners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone } = req.body;
        const result = await query(
          "UPDATE owners SET email=$1,name=$2,phone=$3,updated_at=NOW() WHERE id=$4 AND deleted_at IS NULL RETURNING *",
          [email?.toLowerCase(), name, phone || null, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/owners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE owners SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ADMINS ====================

  app.get(
    "/api/admins",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM admins WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get("/api/admins/check-access", async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.json([]);

      const role = await getUserRole(user.email);
      if (!["owner", "partner", "admin"].includes(role)) return res.json([]);

      if (role === "admin") {
        const adminResult = await query(
          "SELECT * FROM admins WHERE email=$1 AND deleted_at IS NULL",
          [user.email],
        );
        return res.json(adminResult.rows);
      }

      const result = await query(
        "SELECT * FROM admins WHERE deleted_at IS NULL ORDER BY created_at DESC",
      );
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== APP SETTINGS (low-stock threshold etc.) ====================
  // GET — any admin/owner/partner can read.
  app.get(
    "/api/admin/settings/:key",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const r = await query(
          `SELECT key, value, updated_at FROM app_settings WHERE key=$1`,
          [req.params.key],
        );
        if (!r.rows.length) {
          return res.status(404).json({ detail: "setting not found" });
        }
        return res.json(r.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );
  // Keys that partners (non-owners) are allowed to write.
  const PARTNER_WRITABLE_KEYS = new Set([
    "car_brands_page_config",
    "brand_page_config",
    "brands_page_config",
    "car_interface_texts",
    "footer_config",
  ]);
  // PUT — owners write any setting; partners and admins limited to CMS page-config keys.
  app.put(
    "/api/admin/settings/:key",
    requireAdminRole(["owner", "partner", "admin"]) as any,
    async (req: Request, res: Response) => {
      const key = String(req.params.key ?? "");
      const role = (req as any).adminUser?.role;
      if (role !== "owner" && !PARTNER_WRITABLE_KEYS.has(key)) {
        return res.status(403).json({ detail: "only owners may update this setting" });
      }
      try {
        const { value } = req.body || {};
        if (value === undefined) {
          return res.status(400).json({ detail: "value is required" });
        }
        const r = await query(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 updated_at = NOW()
           RETURNING key, value, updated_at`,
          [key, JSON.stringify(value)],
        );
        return res.json(r.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Public settings read — no auth required, for public pages to read page configs.
  // Strict allowlist prevents accidental exposure of other app_settings keys.
  const PUBLIC_SETTINGS_ALLOWLIST = new Set([
    "car_brands_page_config",
    "brand_page_config",
    "brands_page_config",
    "car_interface_texts",
    "footer_config",
  ]);
  app.get(
    "/api/public/settings/:key",
    async (req: Request, res: Response) => {
      const key = String(req.params.key ?? "");
      if (!PUBLIC_SETTINGS_ALLOWLIST.has(key)) {
        return res.status(404).json({ detail: "setting not found" });
      }
      try {
        const r = await query(
          `SELECT key, value, updated_at FROM app_settings WHERE key=$1`,
          [key],
        );
        if (!r.rows.length) return res.status(404).json({ detail: "setting not found" });
        return res.json(r.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/admins",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, address, permissions } = req.body;
        if (!email || !name)
          return res.status(400).json({ detail: "email and name required" });

        const result = await query(
          "INSERT INTO admins (id,email,name,phone,address,permissions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            genId(),
            email.toLowerCase(),
            name,
            phone || null,
            address || null,
            JSON.stringify(permissions || []),
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "Admin already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/admins/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, address, permissions } = req.body;
        const result = await query(
          "UPDATE admins SET email=$1,name=$2,phone=$3,address=$4,permissions=$5,updated_at=NOW() WHERE id=$6 AND deleted_at IS NULL RETURNING *",
          [
            email?.toLowerCase(),
            name,
            phone || null,
            address || null,
            JSON.stringify(permissions || []),
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/admins/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE admins SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PARTNERS ====================

  app.get(
    "/api/partners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM partners WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/partners",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, company_name } = req.body;
        if (!email || !name)
          return res.status(400).json({ detail: "email and name required" });

        const result = await query(
          "INSERT INTO partners (id,email,name,phone,company_name) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [
            genId(),
            email.toLowerCase(),
            name,
            phone || null,
            company_name || null,
          ],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        if (err.code === "23505")
          return res.status(400).json({ detail: "Partner already exists" });
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/partners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, name, phone, company_name } = req.body;
        const result = await query(
          "UPDATE partners SET email=$1,name=$2,phone=$3,company_name=$4,updated_at=NOW() WHERE id=$5 AND deleted_at IS NULL RETURNING *",
          [
            email?.toLowerCase(),
            name,
            phone || null,
            company_name || null,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/partners/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE partners SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== SUBSCRIBERS ====================

  app.get(
    "/api/subscribers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          "SELECT * FROM subscribers WHERE deleted_at IS NULL ORDER BY created_at DESC",
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post("/api/subscribers", async (req: Request, res: Response) => {
    try {
      const { email, name, phone, subscription_type } = req.body;
      if (!email || !name)
        return res.status(400).json({ detail: "email and name required" });

      const result = await query(
        "INSERT INTO subscribers (id,email,name,phone,subscription_type) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [
          genId(),
          email.toLowerCase(),
          name,
          phone || null,
          subscription_type || "basic",
        ],
      );
      return res.json(result.rows[0]);
    } catch (err: any) {
      if (err.code === "23505")
        return res.status(400).json({ detail: "Already subscribed" });
      return res.status(500).json({ detail: err.message });
    }
  });

  app.delete(
    "/api/subscribers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE subscribers SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== SUPPLIERS ====================

  app.get(
    "/api/suppliers",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          `SELECT s.*,
            (SELECT json_agg(json_build_object('id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar))
             FROM car_models cm
             WHERE cm.id::text IN (SELECT jsonb_array_elements_text(COALESCE(s.linked_restaurant_ids, '[]'::jsonb)))
             AND cm.deleted_at IS NULL) AS linked_restaurants,
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar))
             FROM categories c
             WHERE c.id::text IN (SELECT jsonb_array_elements_text(COALESCE(s.linked_category_ids, '[]'::jsonb)))
             AND c.deleted_at IS NULL) AS linked_categories
           FROM suppliers s
           WHERE s.deleted_at IS NULL ORDER BY s.name`,
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/suppliers/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          `SELECT s.*,
            (SELECT json_agg(json_build_object('id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar))
             FROM car_models cm
             WHERE cm.id::text IN (SELECT jsonb_array_elements_text(COALESCE(s.linked_restaurant_ids, '[]'::jsonb)))
             AND cm.deleted_at IS NULL) AS linked_restaurants,
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar))
             FROM categories c
             WHERE c.id::text IN (SELECT jsonb_array_elements_text(COALESCE(s.linked_category_ids, '[]'::jsonb)))
             AND c.deleted_at IS NULL) AS linked_categories
           FROM suppliers s
           WHERE s.id=$1 AND s.deleted_at IS NULL`,
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/suppliers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_product_brand_ids,
          linked_restaurant_ids,
          linked_category_ids,
        } = req.body;
        if (!name) return res.status(400).json({ detail: "name required" });
        const supplierId = genId();
        const result = await query(
          `INSERT INTO suppliers (id,name,name_ar,phone,email,address,notes,phone_numbers,contact_email,address_ar,website_url,description,description_ar,profile_image,slider_images,linked_product_brand_ids,linked_restaurant_ids,linked_category_ids)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            supplierId,
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            JSON.stringify(linked_product_brand_ids || []),
            JSON.stringify(linked_restaurant_ids || []),
            JSON.stringify(linked_category_ids || []),
          ],
        );
        // Sync: update product_brands.supplier_id for linked brands
        if (linked_product_brand_ids && linked_product_brand_ids.length > 0) {
          await query(
            `UPDATE product_brands SET supplier_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [supplierId, linked_product_brand_ids],
          );
        }
        broadcastToAll({ type: "supplier_created", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/suppliers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_product_brand_ids,
          linked_restaurant_ids,
          linked_category_ids,
        } = req.body;
        // Only overwrite linked_product_brand_ids if it was explicitly sent — avoids clearing legacy brand-sync associations
        const hasLegacyBrandIds = 'linked_product_brand_ids' in req.body;
        const result = await query(
          `UPDATE suppliers SET name=$1,name_ar=$2,phone=$3,email=$4,address=$5,notes=$6,
         phone_numbers=$7,contact_email=$8,address_ar=$9,website_url=$10,description=$11,
         description_ar=$12,profile_image=$13,slider_images=$14,
         linked_product_brand_ids=COALESCE($15::jsonb, linked_product_brand_ids),
         linked_restaurant_ids=$16,linked_category_ids=$17,updated_at=NOW()
         WHERE id=$18 AND deleted_at IS NULL RETURNING *`,
          [
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            hasLegacyBrandIds ? JSON.stringify(linked_product_brand_ids || []) : null,
            JSON.stringify(linked_restaurant_ids || []),
            JSON.stringify(linked_category_ids || []),
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        // Sync: only update product_brands.supplier_id when linked_product_brand_ids was explicitly provided
        if (hasLegacyBrandIds) {
          await query(
            `UPDATE product_brands SET supplier_id=NULL WHERE supplier_id=$1 AND deleted_at IS NULL`,
            [req.params.id],
          );
          if (linked_product_brand_ids && linked_product_brand_ids.length > 0) {
            await query(
              `UPDATE product_brands SET supplier_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
              [req.params.id, linked_product_brand_ids],
            );
          }
        }
        broadcastToAll({ type: "supplier_updated", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/suppliers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE suppliers SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({ type: "supplier_deleted", data: { id: req.params.id } });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== DISTRIBUTORS ====================

  app.get(
    "/api/distributors",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          `SELECT d.*,
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar))
             FROM categories c
             WHERE c.id::text IN (SELECT jsonb_array_elements_text(COALESCE(d.linked_category_ids, '[]'::jsonb)))
             AND c.deleted_at IS NULL) AS linked_categories
           FROM distributors d
           WHERE d.deleted_at IS NULL ORDER BY d.name`,
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/distributors/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const role = await getUserRole(user.email);
        const allowedRoles = ["owner", "admin", "partner", "subscriber"];
        if (!allowedRoles.includes(role)) {
          return res.status(403).json({ detail: "Forbidden" });
        }
        const result = await query(
          `SELECT d.*,
            (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'name_ar', c.name_ar))
             FROM categories c
             WHERE c.id::text IN (SELECT jsonb_array_elements_text(COALESCE(d.linked_category_ids, '[]'::jsonb)))
             AND c.deleted_at IS NULL) AS linked_categories
           FROM distributors d
           WHERE d.id=$1 AND d.deleted_at IS NULL`,
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/distributors",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_car_brand_ids,
          linked_category_ids,
          venue_types,
        } = req.body;
        if (!name) return res.status(400).json({ detail: "name required" });
        const distributorId = genId();
        const result = await query(
          `INSERT INTO distributors (id,name,name_ar,phone,email,address,notes,phone_numbers,contact_email,address_ar,website_url,description,description_ar,profile_image,slider_images,linked_car_brand_ids,linked_category_ids,venue_types)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            distributorId,
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            JSON.stringify(linked_car_brand_ids || []),
            JSON.stringify(linked_category_ids || []),
            JSON.stringify(venue_types || []),
          ],
        );
        // Sync: update car_brands.distributor_id for linked brands
        if (linked_car_brand_ids && linked_car_brand_ids.length > 0) {
          await query(
            `UPDATE car_brands SET distributor_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [distributorId, linked_car_brand_ids],
          );
        }
        broadcastToAll({ type: "distributor_created", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/distributors/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          phone,
          phone_numbers,
          email,
          contact_email,
          address,
          address_ar,
          notes,
          description,
          description_ar,
          website_url,
          profile_image,
          slider_images,
          linked_car_brand_ids,
          linked_category_ids,
          venue_types,
        } = req.body;
        // Only overwrite linked_car_brand_ids if explicitly sent — avoids clearing legacy brand-sync associations
        const hasLegacyCarBrandIds = 'linked_car_brand_ids' in req.body;
        const result = await query(
          `UPDATE distributors SET name=$1,name_ar=$2,phone=$3,email=$4,address=$5,notes=$6,
         phone_numbers=$7,contact_email=$8,address_ar=$9,website_url=$10,description=$11,
         description_ar=$12,profile_image=$13,slider_images=$14,
         linked_car_brand_ids=COALESCE($15::jsonb, linked_car_brand_ids),
         linked_category_ids=$16,venue_types=$17,updated_at=NOW()
         WHERE id=$18 AND deleted_at IS NULL RETURNING *`,
          [
            name,
            name_ar || null,
            phone || null,
            email || contact_email || null,
            address || null,
            notes || null,
            JSON.stringify(phone_numbers || []),
            contact_email || email || null,
            address_ar || null,
            website_url || null,
            description || null,
            description_ar || null,
            profile_image || null,
            JSON.stringify(slider_images || []),
            hasLegacyCarBrandIds ? JSON.stringify(linked_car_brand_ids || []) : null,
            JSON.stringify(linked_category_ids || []),
            JSON.stringify(venue_types || []),
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        // Sync: only update car_brands.distributor_id when linked_car_brand_ids was explicitly provided
        if (hasLegacyCarBrandIds) {
          await query(
            `UPDATE car_brands SET distributor_id=NULL WHERE distributor_id=$1 AND deleted_at IS NULL`,
            [req.params.id],
          );
          if (linked_car_brand_ids && linked_car_brand_ids.length > 0) {
            await query(
              `UPDATE car_brands SET distributor_id=$1 WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL`,
              [req.params.id, linked_car_brand_ids],
            );
          }
        }
        broadcastToAll({ type: "distributor_updated", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/distributors/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE distributors SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({ type: "distributor_deleted", data: { id: req.params.id } });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== CUSTOMERS ====================

  app.delete(
    "/api/customers/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE users SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        await query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== NOTIFICATIONS ====================

  app.get(
    "/api/notifications",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "SELECT *, is_read AS read FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
          [userId],
        );
        // G3: record a 'delivered' event for any notification the user just
        // received from the API.  ON CONFLICT DO NOTHING keeps it idempotent
        // so repeated polls don't inflate counts.
        if (result.rows.length > 0) {
          const ids = result.rows.map((r: any) => r.id);
          query(
            `INSERT INTO notification_events (notification_id, user_id, event)
             SELECT id, $1, 'delivered' FROM unnest($2::uuid[]) AS t(id)
             ON CONFLICT DO NOTHING`,
            [userId, ids],
          ).catch(() => {});
        }
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // G3: explicit tracking endpoint for the mobile push response handler
  // (e.g. user tapped a notification or the system delivered it natively).
  // Verifies the notification belongs to the caller before inserting an event
  // so a malicious client can't poison the analytics aggregate by posting
  // arbitrary UUIDs.  Returns 404 for unknown / foreign notification IDs.
  app.post(
    "/api/notifications/:id/track",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const evt = String(req.body?.event || "").toLowerCase();
        if (!["delivered", "opened"].includes(evt)) {
          return res.status(400).json({ detail: "event must be delivered|opened" });
        }
        const own = await query(
          "SELECT 1 FROM notifications WHERE id = $1 AND user_id = $2",
          [req.params.id, userId],
        );
        if (own.rowCount === 0) {
          return res.status(404).json({ detail: "Notification not found" });
        }
        await query(
          `INSERT INTO notification_events (notification_id, user_id, event)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [req.params.id, userId, evt],
        );
        return res.json({ ok: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/notifications/:id/read",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const result = await query(
          "UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2 RETURNING metadata",
          [req.params.id, userId],
        );
        // G3: marking as read implies the user opened the notification.
        // Only record the event if the UPDATE actually matched a row owned by
        // the caller, so a malicious client can't poison the analytics feed
        // by PATCHing arbitrary notification IDs.
        if ((result.rowCount ?? 0) > 0) {
          query(
            `INSERT INTO notification_events (notification_id, user_id, event)
             VALUES ($1, $2, 'opened') ON CONFLICT DO NOTHING`,
            [req.params.id, userId],
          ).catch(() => {});
        }
        // If this is an order_updated notification, update the order's customer_last_read_status
        const meta = result.rows[0]?.metadata;
        if (
          meta &&
          meta.kind === "order_updated" &&
          meta.order_id &&
          meta.new_status
        ) {
          try {
            await query(
              "UPDATE orders SET customer_last_read_status=$1, customer_read_at=NOW() WHERE id=$2 AND user_id=$3",
              [meta.new_status, meta.order_id, userId],
            );
            // Broadcast to admins so their orders list updates in real-time
            broadcastToAll({
              type: "order_notification_read",
              data: {
                order_id: meta.order_id,
                status: meta.new_status,
                customer_id: userId,
              },
            });
          } catch {}
        }
        return res.json({ message: "Marked as read" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/notifications/read-all",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        // Mark all unread notifications as read AND update the
        // order's customer_last_read_status for any order_updated ones,
        // then broadcast so admins see the live update.
        const result = await query(
          `UPDATE notifications
              SET is_read = TRUE
            WHERE user_id = $1 AND is_read = FALSE
        RETURNING metadata`,
          [userId],
        );
        const orderReads: { order_id: string; status: string }[] = [];
        for (const row of result.rows) {
          const meta = row?.metadata;
          if (
            meta &&
            meta.kind === "order_updated" &&
            meta.order_id &&
            meta.new_status
          ) {
            try {
              await query(
                "UPDATE orders SET customer_last_read_status=$1, customer_read_at=NOW() WHERE id=$2 AND user_id=$3",
                [meta.new_status, meta.order_id, userId],
              );
              orderReads.push({
                order_id: meta.order_id,
                status: meta.new_status,
              });
            } catch {}
          }
        }
        for (const r of orderReads) {
          broadcastToAll({
            type: "order_notification_read",
            data: { ...r, customer_id: userId },
          });
        }
        return res.json({ message: "All marked as read" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PROMOTIONS ====================

  app.get("/api/promotions", async (req: Request, res: Response) => {
    try {
      const { promotion_type, active_only = "true" } = req.query;
      let q = "SELECT * FROM promotions WHERE deleted_at IS NULL";
      const params: any[] = [];
      let paramIdx = 1;

      if (active_only === "true") {
        q += ` AND is_active = TRUE`;
      }
      if (promotion_type) {
        params.push(promotion_type);
        q += ` AND promotion_type = $${paramIdx}`;
        paramIdx++;
      }
      q += " ORDER BY sort_order ASC, created_at DESC";

      const result = await query(q, params);
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/promotions/:id", async (req: Request, res: Response) => {
    try {
      const result = await query(
        "SELECT * FROM promotions WHERE id=$1 AND deleted_at IS NULL",
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      return res.json(result.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/promotions",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          title,
          title_ar,
          image,
          promotion_type = "slider",
          is_active = true,
          target_product_id,
          target_car_model_id,
          sort_order = 0,
        } = req.body;
        if (!title) return res.status(400).json({ detail: "title required" });

        const result = await query(
          "INSERT INTO promotions (id,title,title_ar,image,promotion_type,is_active,target_product_id,target_car_model_id,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            genId(),
            title,
            title_ar || null,
            image || null,
            promotion_type,
            is_active,
            target_product_id || null,
            target_car_model_id || null,
            sort_order,
          ],
        );
        const promo = result.rows[0];

        if (is_active) {
          let product_name: string | null = null;
          let car_model_name: string | null = null;
          let car_model_image: string | null = null;
          if (target_product_id) {
            try {
              const pRow = await query(
                "SELECT name_ar, name FROM products WHERE id=$1 AND deleted_at IS NULL",
                [target_product_id],
              );
              product_name =
                pRow.rows[0]?.name_ar || pRow.rows[0]?.name || null;
            } catch {}
          }
          let car_model_year_start: number | null = null;
          let car_model_year_end: number | null = null;
          if (target_car_model_id) {
            try {
              const cmRow = await query(
                "SELECT name_ar, name, image_url, year_start, year_end FROM car_models WHERE id=$1 AND deleted_at IS NULL",
                [target_car_model_id],
              );
              if (cmRow.rows[0]) {
                car_model_name =
                  cmRow.rows[0].name_ar || cmRow.rows[0].name || null;
                car_model_image = cmRow.rows[0].image_url || null;
                car_model_year_start = cmRow.rows[0].year_start || null;
                car_model_year_end = cmRow.rows[0].year_end || null;
              }
            } catch {}
          }
          const promoMeta = {
            kind: "promotion",
            target_id: promo.id,
            image: image || null,
            title: title_ar || title,
            target_product_id: target_product_id || null,
            target_car_model_id: target_car_model_id || null,
            product_name,
            car_model_name,
            car_model_image,
            car_model_year_start,
            car_model_year_end,
          };
          // Broadcast promotion_started event to refresh product cache + show notification
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: promo.id,
              title: title_ar || title,
              message: `عرض جديد: ${title_ar || title}`,
            },
          });

          // Notify admins via DB + WS (targeted)
          try {
            const admins = await query(
              "SELECT DISTINCT u.id FROM users u WHERE u.email IN (SELECT email FROM admins WHERE deleted_at IS NULL) OR u.email IN (SELECT email FROM owners WHERE deleted_at IS NULL)",
            );
            for (const admin of admins.rows) {
              const notifId = genId();
              await query(
                "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
                [
                  notifId,
                  admin.id,
                  "New Promotion",
                  "عرض جديد",
                  `New promotion added: ${title}`,
                  `تم إضافة عرض جديد: ${title_ar || title}`,
                  JSON.stringify(promoMeta),
                ],
              );
              broadcastToUser(admin.id, {
                type: "notification",
                data: {
                  id: notifId,
                  title: "عرض جديد",
                  message: `تم إضافة عرض جديد: ${title_ar || title}`,
                  type: "info",
                  read: false,
                  created_at: new Date().toISOString(),
                  metadata: promoMeta,
                },
              });
            }
          } catch {}
        }

        broadcastToAll({ type: "promotion_created", data: promo });
        broadcastToAll({ type: "marketing_slider_changed" });
        return res.json(promo);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/promotions/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          title,
          title_ar,
          image,
          promotion_type,
          is_active,
          target_product_id,
          target_car_model_id,
          sort_order,
        } = req.body;

        // Get current state to detect activation change
        const oldPromo = await query(
          "SELECT is_active FROM promotions WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        const wasActive = oldPromo.rows[0]?.is_active;

        const result = await query(
          "UPDATE promotions SET title=$1,title_ar=$2,image=$3,promotion_type=$4,is_active=$5,target_product_id=$6,target_car_model_id=$7,sort_order=$8,updated_at=NOW() WHERE id=$9 AND deleted_at IS NULL RETURNING *",
          [
            title,
            title_ar || null,
            image || null,
            promotion_type,
            is_active,
            target_product_id || null,
            target_car_model_id || null,
            sort_order || 0,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const promo = result.rows[0];

        // Broadcast activation/deactivation change
        if (is_active && !wasActive) {
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: promo.id,
              title: title_ar || title,
              message: `عرض جديد: ${title_ar || title}`,
            },
          });
        } else if (!is_active && wasActive) {
          broadcastToAll({ type: "promotion_ended", data: { id: promo.id } });
        }

        broadcastToAll({ type: "promotion_updated", data: promo });
        broadcastToAll({ type: "marketing_slider_changed" });
        return res.json(promo);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.patch(
    "/api/promotions/:id/reorder",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const { sort_order } = req.body;
        const result = await query(
          "UPDATE promotions SET sort_order=$1,updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL RETURNING *",
          [sort_order, req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        broadcastToAll({ type: "promotion_reordered", data: result.rows[0] });
        broadcastToAll({ type: "marketing_slider_changed" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/promotions/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE promotions SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({ type: "promotion_deleted", data: { id: req.params.id } });
        broadcastToAll({ type: "marketing_slider_changed" });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== BUNDLE OFFERS ====================

  app.get("/api/bundle-offers", async (req: Request, res: Response) => {
    try {
      const { active_only = "true" } = req.query;
      let q = `
        SELECT bo.*,
          ROUND(AVG(bor.rating)::numeric, 1) AS rating_average,
          COUNT(DISTINCT bor.id)::int AS rating_count,
          CASE WHEN bo.product_ids IS NOT NULL AND jsonb_array_length(bo.product_ids) > 0
            THEN (SELECT COALESCE(SUM(p.price), 0)::float
                  FROM products p
                  WHERE p.deleted_at IS NULL
                  AND p.id::text IN (SELECT jsonb_array_elements_text(bo.product_ids)))
            ELSE 0 END AS original_total,
          CASE WHEN bo.product_ids IS NOT NULL AND jsonb_array_length(bo.product_ids) > 0
            THEN ROUND(((SELECT COALESCE(SUM(p.price), 0)
                         FROM products p
                         WHERE p.deleted_at IS NULL
                         AND p.id::text IN (SELECT jsonb_array_elements_text(bo.product_ids)))
                        * (1 - COALESCE(bo.discount_percentage, 0) / 100))::numeric, 2)::float
            ELSE 0 END AS discounted_total,
          CASE WHEN bo.product_ids IS NOT NULL AND jsonb_array_length(bo.product_ids) > 0
            THEN (SELECT COUNT(*)::int FROM products p
                  WHERE p.deleted_at IS NULL
                  AND p.id::text IN (SELECT jsonb_array_elements_text(bo.product_ids)))
            ELSE 0 END AS product_count
        FROM bundle_offers bo
        LEFT JOIN bundle_offer_ratings bor ON bor.bundle_offer_id = bo.id
        WHERE bo.deleted_at IS NULL`;
      if (active_only === "true") q += " AND bo.is_active = TRUE";
      q += " GROUP BY bo.id ORDER BY bo.created_at DESC";
      const result = await query(q);
      return res.json(
        result.rows.map((b: any) => ({
          ...b,
          product_ids: b.product_ids || [],
          rating_average: b.rating_average ? parseFloat(b.rating_average) : null,
          rating_count: b.rating_count || 0,
          original_total: b.original_total ? parseFloat(b.original_total) : null,
          discounted_total: b.discounted_total ? parseFloat(b.discounted_total) : null,
          product_count: b.product_count || 0,
        })),
      );
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/bundle-offers/:id", async (req: Request, res: Response) => {
    try {
      const paramId = String(req.params.id);
      const isValidUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          paramId,
        );
      if (!isValidUUID) return res.status(404).json({ detail: "Not found" });
      const result = await query(
        "SELECT * FROM bundle_offers WHERE id=$1 AND deleted_at IS NULL",
        [req.params.id],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ detail: "Not found" });
      const b = result.rows[0];
      b.product_ids = b.product_ids || [];

      // Fetch full product details for each product_id
      let products: any[] = [];
      if (b.product_ids.length > 0) {
        const productIds: string[] = Array.isArray(b.product_ids)
          ? b.product_ids
          : [];
        if (productIds.length > 0) {
          const productsResult = await query(
            `SELECT p.id, p.name, p.name_ar, p.description, p.description_ar,
                    p.price::float as price, p.sku, p.image_url, p.images, p.stock_quantity,
                    c.id as category_id, c.name as category_name, c.name_ar as category_name_ar,
                    pb.id as brand_id, pb.name as brand_name, pb.name_ar as brand_name_ar
             FROM products p
             LEFT JOIN categories c ON p.category_id = c.id
             LEFT JOIN product_brands pb ON p.product_brand_id = pb.id
             WHERE p.id::text IN (SELECT jsonb_array_elements_text($1::jsonb))
             AND p.deleted_at IS NULL`,
            [JSON.stringify(productIds)],
          );
          products = productsResult.rows.map((p: any) => ({
            ...p,
            price: parseFloat(p.price) || 0,
            images: p.images || [],
            category: p.category_id
              ? {
                  id: p.category_id,
                  name: p.category_name,
                  name_ar: p.category_name_ar,
                }
              : null,
            product_brand: p.brand_id
              ? { id: p.brand_id, name: p.brand_name, name_ar: p.brand_name_ar }
              : null,
          }));
        }
      }

      // Calculate totals
      const originalTotal = products.reduce((sum, p) => sum + p.price, 0);
      const discountPct = parseFloat(b.discount_percentage) || 0;
      const discountedTotal = originalTotal * (1 - discountPct / 100);

      // Fetch car model if linked
      let targetCarModel = null;
      if (b.car_model_id) {
        const cmResult = await query(
          "SELECT id, name, name_ar, image_url FROM car_models WHERE id=$1 AND deleted_at IS NULL",
          [b.car_model_id],
        ).catch(() => ({ rows: [] }));
        if (cmResult.rows.length > 0) targetCarModel = cmResult.rows[0];
      }

      return res.json({
        ...b,
        discount_percentage: discountPct,
        products,
        original_total: originalTotal,
        discounted_total: discountedTotal,
        target_car_model: targetCarModel,
      });
    } catch (err: any) {
      if (err.code === "22P02")
        return res.status(404).json({ detail: "Not found" });
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/bundle-offers",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          discount_percentage,
          target_car_model_id,
          product_ids,
          image,
          image_url,
          is_active = true,
        } = req.body;
        if (!name || discount_percentage === undefined)
          return res
            .status(400)
            .json({ detail: "name and discount_percentage required" });

        const result = await query(
          "INSERT INTO bundle_offers (id,name,name_ar,description,description_ar,discount_percentage,car_model_id,product_ids,image_url,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            genId(),
            name,
            name_ar || null,
            description || null,
            description_ar || null,
            discount_percentage,
            target_car_model_id || null,
            JSON.stringify(product_ids || []),
            image_url || image || null,
            is_active,
          ],
        );
        const b = result.rows[0];
        b.product_ids = b.product_ids || [];

        // Respond immediately — do not block on notification side-effects
        broadcastToAll({ type: "bundle_created", data: b });
        broadcastToAll({ type: "marketing_slider_changed" });
        res.json(b);

        // Fire-and-forget: send in-app notifications to admins/owners
        if (is_active) {
          (async () => {
            try {
              let car_model_name: string | null = null;
              let car_model_image: string | null = null;
              let car_model_year_start: number | null = null;
              let car_model_year_end: number | null = null;
              if (target_car_model_id) {
                try {
                  const cmRow = await query(
                    "SELECT name_ar, name, image_url, year_start, year_end FROM car_models WHERE id=$1 AND deleted_at IS NULL",
                    [target_car_model_id],
                  );
                  if (cmRow.rows[0]) {
                    car_model_name =
                      cmRow.rows[0].name_ar || cmRow.rows[0].name || null;
                    car_model_image = cmRow.rows[0].image_url || null;
                    car_model_year_start = cmRow.rows[0].year_start || null;
                    car_model_year_end = cmRow.rows[0].year_end || null;
                  }
                } catch {}
              }
              const bundleMeta = {
                kind: "bundle_offer",
                target_id: b.id,
                image: image || null,
                discount_percentage,
                title: name_ar || name,
                product_count: (product_ids || []).length,
                car_model_id: target_car_model_id || null,
                car_model_name,
                car_model_image,
                car_model_year_start,
                car_model_year_end,
              };
              broadcastToAll({
                type: "promotion_started",
                data: {
                  id: b.id,
                  title: name_ar || name,
                  message: `عرض مجمع جديد: ${name_ar || name} - خصم ${discount_percentage}%`,
                },
              });

              // Notify ALL active users (not just admins) about the new bundle
              const allUsers = await query(
                "SELECT id FROM users WHERE deleted_at IS NULL",
              );
              await Promise.all(
                allUsers.rows.map(async (usr: { id: string }) => {
                  const notifId = genId();
                  await query(
                    "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
                    [
                      notifId,
                      usr.id,
                      "New Bundle Offer",
                      "عرض مجمع جديد",
                      `New bundle offer: ${name} - ${discount_percentage}% off`,
                      `عرض مجمع جديد: ${name_ar || name} - خصم ${discount_percentage}%`,
                      JSON.stringify(bundleMeta),
                    ],
                  );
                  broadcastToUser(usr.id, {
                    type: "notification",
                    data: {
                      id: notifId,
                      title: "عرض مجمع جديد",
                      message: `عرض مجمع جديد: ${name_ar || name} - خصم ${discount_percentage}%`,
                      type: "info",
                      read: false,
                      created_at: new Date().toISOString(),
                      metadata: bundleMeta,
                    },
                  });
                }),
              );
            } catch {}
          })();
        }

        return;
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.put(
    "/api/bundle-offers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          name_ar,
          description,
          description_ar,
          discount_percentage,
          target_car_model_id,
          product_ids,
          image,
          image_url,
          is_active,
        } = req.body;

        const oldBundle = await query(
          "SELECT is_active, image_url FROM bundle_offers WHERE id=$1 AND deleted_at IS NULL",
          [req.params.id],
        );
        const wasActive = oldBundle.rows[0]?.is_active;
        const existingImageUrl = oldBundle.rows[0]?.image_url ?? null;

        const result = await query(
          "UPDATE bundle_offers SET name=$1,name_ar=$2,description=$3,description_ar=$4,discount_percentage=$5,car_model_id=$6,product_ids=$7,image_url=$8,is_active=$9,updated_at=NOW() WHERE id=$10 AND deleted_at IS NULL RETURNING *",
          [
            name,
            name_ar || null,
            description || null,
            description_ar || null,
            discount_percentage,
            target_car_model_id || null,
            JSON.stringify(product_ids || []),
            image_url ?? image ?? existingImageUrl,
            is_active,
            req.params.id,
          ],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Not found" });
        const b = result.rows[0];

        if (is_active && !wasActive) {
          broadcastToAll({
            type: "promotion_started",
            data: {
              id: b.id,
              title: name_ar || name,
              message: `عرض مجمع: ${name_ar || name} - خصم ${discount_percentage}%`,
            },
          });
        } else if (!is_active && wasActive) {
          broadcastToAll({ type: "promotion_ended", data: { id: b.id } });
        }

        broadcastToAll({ type: "bundle_updated", data: b });
        broadcastToAll({ type: "marketing_slider_changed" });
        return res.json(b);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/bundle-offers/:id",
    requireAdminRole() as any,
    async (req: Request, res: Response) => {
      try {
        await query("UPDATE bundle_offers SET deleted_at=NOW() WHERE id=$1", [
          req.params.id,
        ]);
        broadcastToAll({ type: "bundle_deleted", data: { id: req.params.id } });
        broadcastToAll({ type: "marketing_slider_changed" });
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ── Bundle offer ratings (Task #93) ──────────────────────────────────────

  app.get("/api/bundle-offers/:id/ratings/summary", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT ROUND(AVG(rating)::numeric, 1) AS average, COUNT(id)::int AS count
         FROM bundle_offer_ratings WHERE bundle_offer_id = $1`,
        [req.params.id],
      );
      const row = result.rows[0];
      return res.json({
        average: row.average ? parseFloat(row.average) : null,
        count: row.count || 0,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.get("/api/bundle-offers/:id/ratings/my", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT * FROM bundle_offer_ratings WHERE bundle_offer_id=$1 AND user_id=$2`,
        [req.params.id, (req as any).user.id],
      );
      return res.json(result.rows[0] || null);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post("/api/bundle-offers/:id/ratings", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const ratingNum = parseInt(req.body.rating, 10);
      if (!ratingNum || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ detail: "Rating must be between 1 and 5." });
      }
      const result = await query(
        `INSERT INTO bundle_offer_ratings (bundle_offer_id, user_id, rating, review)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (bundle_offer_id, user_id)
         DO UPDATE SET rating = EXCLUDED.rating, review = EXCLUDED.review, updated_at = NOW()
         RETURNING *`,
        [req.params.id, (req as any).user.id, ratingNum, req.body.review || null],
      );
      broadcastToAll({ type: "bundle_rating_updated", data: { bundle_offer_id: req.params.id } });
      return res.json(result.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== MARKETING ====================

  app.get("/api/marketing/home-slider", async (req: Request, res: Response) => {
    try {
      const [promotionsResult, bundlesResult] = await Promise.all([
        query(
          `SELECT p.*,
                  CASE WHEN p.target_product_id IS NOT NULL THEN
                    (SELECT json_build_object('id', pr.id, 'name', pr.name, 'name_ar', pr.name_ar)
                     FROM products pr WHERE pr.id = p.target_product_id AND pr.deleted_at IS NULL)
                  END as target_product,
                  CASE WHEN p.target_car_model_id IS NOT NULL THEN
                    (SELECT json_build_object('id', cm.id, 'name', cm.name, 'name_ar', cm.name_ar)
                     FROM car_models cm WHERE cm.id = p.target_car_model_id AND cm.deleted_at IS NULL)
                  END as target_car_model
           FROM promotions p
           WHERE p.deleted_at IS NULL AND p.is_active=TRUE AND p.promotion_type='slider'
           ORDER BY p.sort_order ASC`,
        ),
        query(
          `SELECT bo.*,
                  bo.name as title, bo.name_ar as title_ar,
                  bo.description as subtitle, bo.description_ar as subtitle_ar,
                  bo.discount_percentage::float as discount_percentage,
                  (SELECT json_agg(json_build_object('id', pr.id, 'name', pr.name, 'name_ar', pr.name_ar, 'price', pr.price::float, 'image_url', pr.image_url))
                   FROM products pr 
                   WHERE pr.id::text IN (SELECT jsonb_array_elements_text(bo.product_ids))
                   AND pr.deleted_at IS NULL
                  ) as products
           FROM bundle_offers bo
           WHERE bo.deleted_at IS NULL AND bo.is_active=TRUE
           ORDER BY bo.created_at DESC LIMIT 10`,
        ).catch(() => ({ rows: [] })),
      ]);

      const promotions = promotionsResult.rows.map((p: any) => ({
        ...p,
        type: "promotion",
      }));

      const bundles = (bundlesResult as any).rows.map((b: any) => {
        const products = b.products || [];
        const discountPct = parseFloat(b.discount_percentage) || 0;
        const originalTotal = products.reduce(
          (sum: number, p: any) => sum + (parseFloat(p.price) || 0),
          0,
        );
        const discountedTotal = originalTotal * (1 - discountPct / 100);
        return {
          ...b,
          type: "bundle_offer",
          discount_percentage: discountPct,
          original_total: parseFloat(originalTotal.toFixed(2)),
          discounted_total: parseFloat(discountedTotal.toFixed(2)),
          product_count: products.length,
        };
      });

      // Interleave promotions and bundles
      const items = [...promotions, ...bundles].sort((a: any, b: any) => {
        // promotions come first by sort_order, bundles after
        if (a.type === "promotion" && b.type === "bundle_offer") return -1;
        if (a.type === "bundle_offer" && b.type === "promotion") return 1;
        return 0;
      });

      return res.json(items);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== COMMENTS ====================

  app.get("/api/comments/:productId", async (req: Request, res: Response) => {
    try {
      const currentUser = await getCurrentUser(req);
      const currentUserId = currentUser?.id || null;
      const currentUserRole = currentUser
        ? await getUserRole(currentUser.email)
        : null;
      const isOwnerOrAdmin =
        currentUserRole &&
        ["owner", "partner", "admin"].includes(currentUserRole);

      const [commentsResult, statsResult] = await Promise.all([
        query(
          `SELECT c.*, u.name as user_name, u.picture as user_picture
           FROM comments c JOIN users u ON c.user_id = u.id
           WHERE c.product_id=$1 AND c.deleted_at IS NULL
           ORDER BY c.created_at DESC`,
          [req.params.productId],
        ),
        query(
          `SELECT COUNT(*) as rating_count, AVG(rating)::float as avg_rating
           FROM comments
           WHERE product_id=$1 AND deleted_at IS NULL AND rating IS NOT NULL`,
          [req.params.productId],
        ),
      ]);
      const stats = statsResult.rows[0];
      const comments = commentsResult.rows.map((c: any) => ({
        ...c,
        is_owner: isOwnerOrAdmin
          ? true
          : currentUserId
            ? c.user_id === currentUserId
            : false,
      }));
      return res.json({
        comments,
        avg_rating: stats.avg_rating ? parseFloat(stats.avg_rating) : null,
        rating_count: parseInt(stats.rating_count) || 0,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post(
    "/api/comments",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const { product_id, text, rating } = req.body;
        if (!product_id || !text)
          return res
            .status(400)
            .json({ detail: "product_id and text required" });

        const result = await query(
          "INSERT INTO comments (id,product_id,user_id,text,rating) VALUES ($1,$2,$3,$4,$5) RETURNING *",
          [genId(), product_id, userId, text, rating || null],
        );
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.delete(
    "/api/comments/:id",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user.id;
        const user = (req as any).user;
        const role = await getUserRole(user.email);

        if (["owner", "partner", "admin"].includes(role)) {
          await query("UPDATE comments SET deleted_at=NOW() WHERE id=$1", [
            req.params.id,
          ]);
        } else {
          await query(
            "UPDATE comments SET deleted_at=NOW() WHERE id=$1 AND user_id=$2",
            [req.params.id, userId],
          );
        }
        return res.json({ message: "Deleted" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ANALYTICS ====================

  app.get(
    "/api/analytics/overview",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const [
          ordersResult,
          usersResult,
          productsResult,
          revenueResult,
          todayResult,
          monthResult,
        ] = await Promise.all([
          query(
            "SELECT COUNT(*) as count, status FROM orders WHERE deleted_at IS NULL GROUP BY status",
          ),
          query("SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL"),
          query(
            "SELECT COUNT(*) as count FROM products WHERE deleted_at IS NULL",
          ),
          query(
            "SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE deleted_at IS NULL AND status != 'cancelled'",
          ),
          query(
            "SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count FROM orders WHERE deleted_at IS NULL AND status != 'cancelled' AND DATE(created_at) = CURRENT_DATE",
          ),
          query(
            "SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count FROM orders WHERE deleted_at IS NULL AND status != 'cancelled' AND created_at >= DATE_TRUNC('month', CURRENT_DATE)",
          ),
        ]);

        const ordersByStatus: Record<string, number> = {};
        ordersResult.rows.forEach((r: any) => {
          ordersByStatus[r.status] = parseInt(r.count);
        });

        return res.json({
          total_orders: Object.values(ordersByStatus).reduce(
            (a: number, b: number) => a + b,
            0,
          ),
          orders_by_status: ordersByStatus,
          total_users: parseInt(usersResult.rows[0].count),
          total_products: parseInt(productsResult.rows[0].count),
          total_revenue: parseFloat(revenueResult.rows[0].total),
          today_revenue: parseFloat(todayResult.rows[0].total),
          today_orders: parseInt(todayResult.rows[0].count),
          month_revenue: parseFloat(monthResult.rows[0].total),
          month_orders: parseInt(monthResult.rows[0].count),
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/analytics/sales",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
         FROM orders WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at) ORDER BY date`,
        );
        return res.json(result.rows);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // G3: notification delivery analytics — sent / delivered / opened counts
  // and rates over the last 30 days, plus a 30-day daily series for charting.
  app.get(
    "/api/analytics/notifications",
    requireAdminRole(["owner", "partner"]) as any,
    async (_req: Request, res: Response) => {
      try {
        const totals = await query(
          `SELECT event, COUNT(*)::int AS count
             FROM notification_events
            WHERE occurred_at >= NOW() - INTERVAL '30 days'
            GROUP BY event`,
        );
        const series = await query(
          `SELECT DATE(occurred_at) AS date,
                  COUNT(*) FILTER (WHERE event = 'sent')::int      AS sent,
                  COUNT(*) FILTER (WHERE event = 'delivered')::int AS delivered,
                  COUNT(*) FILTER (WHERE event = 'opened')::int    AS opened
             FROM notification_events
            WHERE occurred_at >= NOW() - INTERVAL '30 days'
            GROUP BY DATE(occurred_at)
            ORDER BY date`,
        );
        const counts: Record<string, number> = { sent: 0, delivered: 0, opened: 0 };
        for (const r of totals.rows) counts[r.event] = r.count;
        const sent = counts.sent || 0;
        const delivered = counts.delivered || 0;
        const opened = counts.opened || 0;
        return res.json({
          period_days: 30,
          totals: { sent, delivered, opened },
          rates: {
            delivery_rate: sent > 0 ? +(delivered / sent).toFixed(4) : 0,
            open_rate:     sent > 0 ? +(opened / sent).toFixed(4)    : 0,
          },
          daily: series.rows,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== SYNC ====================

  app.post("/api/sync/pull", requireAuth, async (req: Request, res: Response) => {
    try {
      const { last_pulled_at, tables = [] } = req.body;
      const since = last_pulled_at ? new Date(last_pulled_at) : new Date(0);

      const syncData: Record<string, any> = {};
      const requestedTables =
        tables.length > 0
          ? tables
          : [
              "products",
              "categories",
              "car_brands",
              "car_models",
              "product_brands",
              "promotions",
              "bundle_offers",
            ];

      // Explicit column allowlists prevent internal fields (deleted_at, created_at,
      // soft-delete flags, internal FKs) from leaking to mobile clients.
      // Only columns consumed by the mobile offline cache are selected.
      // categories/promotions/bundle_offers are server-filtered to active rows so
      // clients never receive inactive or soft-deleted records.
      const tableQueries: Record<string, string> = {
        products: `SELECT p.*, pb.name as product_brand_name, c.name as category_name FROM products p LEFT JOIN product_brands pb ON p.product_brand_id = pb.id LEFT JOIN categories c ON p.category_id = c.id WHERE p.updated_at > $1`,
        // is_active = TRUE intentional: mobile offline cache must not receive inactive categories
        categories: `SELECT id, name, name_ar, description, description_ar, image_url, sort_order, updated_at, icon, parent_id FROM categories WHERE updated_at > $1 AND is_active = TRUE AND (deleted_at IS NULL OR deleted_at > $1)`,
        car_brands: `SELECT id, name, name_ar, logo_url, logo, updated_at FROM car_brands WHERE updated_at > $1 AND (deleted_at IS NULL OR deleted_at > $1)`,
        car_models: `SELECT id, car_brand_id, name, name_ar, year, year_start, year_end, image_url, images, description, description_ar, variants, chassis_number, catalog_pdf, fuel_type, brand_id, updated_at, tables_count, video_url, receipt_language, latitude, longitude FROM car_models WHERE updated_at > $1 AND (deleted_at IS NULL OR deleted_at > $1)`,
        product_brands: `SELECT id, name, name_ar, description, image_url, sort_order, updated_at, logo, country_of_origin, country_of_origin_ar FROM product_brands WHERE updated_at > $1 AND (deleted_at IS NULL OR deleted_at > $1)`,
        // is_active omitted from SELECT: WHERE clause already guarantees is_active=TRUE
        promotions: `SELECT id, title, title_ar, image, promotion_type, target_product_id, target_car_model_id, sort_order, updated_at FROM promotions WHERE updated_at > $1 AND deleted_at IS NULL AND is_active=TRUE`,
        bundle_offers: `SELECT id, name, name_ar, description, description_ar, image_url, images, discount_percentage, total_price, sort_order, product_ids, products, car_model_id, car_model_year_start, car_model_year_end, updated_at FROM bundle_offers WHERE updated_at > $1 AND deleted_at IS NULL AND is_active=TRUE`,
      };

      for (const table of requestedTables) {
        if (tableQueries[table]) {
          const result = await query(tableQueries[table], [since]);
          syncData[table] = result.rows;
        }
      }

      return res.json({
        timestamp: Date.now(),
        data: syncData,
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== UPLOAD-URL (Presigned PUT for large files, e.g. video) ====================
  // Returns { uploadURL, downloadURL } so the client can PUT directly to GCS.
  // Use this instead of /api/upload for binary file uploads (video, PDF, etc.)
  app.post(
    "/api/upload-url",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const privateDirSet = !!process.env.PRIVATE_OBJECT_DIR;
        if (!privateDirSet) {
          return res.status(503).json({ detail: "Object Storage not configured" });
        }
        const storage = new ObjectStorageService();
        const { uploadURL, downloadURL, objectPath } = await storage.getObjectEntityURLPair();
        return res.json({ uploadURL, downloadURL, objectPath });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== FINALIZE-UPLOAD (Set ACL to public, return stable serving URL) ====================
  // Called by admin after a successful PUT to the presigned uploadURL.
  // Sets the object's ACL to public so it can be served without auth via /api/media/*.
  app.post(
    "/api/finalize-upload",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { object_path } = req.body;
        if (!object_path || typeof object_path !== "string" || !object_path.startsWith("/objects/")) {
          return res.status(400).json({ detail: "Valid object_path required (must start with /objects/)" });
        }
        const user = (req as any).user;
        const storage = new ObjectStorageService();
        const objectFile = await storage.getObjectEntityFile(object_path);
        await setObjectAclPolicy(objectFile, {
          owner: user?.id ?? "admin-system",
          visibility: "public",
        });
        // Stable serving URL: /api/media/<uuid-path> (no expiry, public ACL enforced server-side)
        const subPath = object_path.slice("/objects".length); // e.g. /uploads/<uuid>
        const servingUrl = `/api/media${subPath}`;
        return res.json({ servingUrl, object_path });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== UPLOAD (Image) ====================

  app.post(
    "/api/upload",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { image_data, url } = req.body;

        // URL passthrough — caller already has a remote URL
        if (url) {
          return res.json({ url, image_url: url });
        }

        if (!image_data) {
          return res.status(400).json({ detail: "No image data provided" });
        }

        // Attempt to store via Object Storage when available
        const privateDirSet = !!process.env.PRIVATE_OBJECT_DIR;
        if (privateDirSet) {
          try {
            const storage = new ObjectStorageService();
            const { uploadURL, downloadURL } = await storage.getObjectEntityURLPair();

            // Strip data-URL prefix if present (e.g. "data:image/jpeg;base64,...")
            const base64Data = image_data.includes(",")
              ? image_data.split(",")[1]
              : image_data;
            const mimeMatch = image_data.match(/^data:([^;]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

            const buffer = Buffer.from(base64Data, "base64");
            const putResp = await fetch(uploadURL, {
              method: "PUT",
              headers: { "Content-Type": mimeType, "Content-Length": String(buffer.length) },
              body: buffer,
            });

            if (!putResp.ok) {
              clog.warn("[Upload] Object Storage PUT failed, falling back to base64");
              return res.json({ url: image_data, image_url: image_data });
            }

            return res.json({ url: downloadURL, image_url: downloadURL });
          } catch (storageErr: any) {
            clog.warn("[Upload] Object Storage error, falling back to base64:", storageErr.message);
          }
        }

        // Fallback: store base64 directly in DB (no Object Storage configured)
        return res.json({ url: image_data, image_url: image_data });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== OBJECT STORAGE — PUBLIC IMAGES ====================
  // Serves publicly-accessible objects (product images, thumbnails, etc.)
  // stored in the configured PUBLIC_OBJECT_SEARCH_PATHS bucket paths.
  // No authentication required — objects must have public visibility in ACL.
  // Use app.use so nested paths like /api/public-objects/products/<uuid>.jpg resolve correctly
  app.use(
    "/api/public-objects",
    async (req: Request, res: Response, next: any) => {
      if (req.method !== "GET") return next();
      try {
        const publicPathsSet = !!process.env.PUBLIC_OBJECT_SEARCH_PATHS;
        if (!publicPathsSet) {
          return res.status(503).json({ detail: "Object Storage not configured" });
        }
        // req.path is everything after /api/public-objects, e.g. /products/uuid.jpg
        const filePath = req.path.replace(/^\//, "");
        if (!filePath) return res.status(400).json({ detail: "Path required" });

        const storage = new ObjectStorageService();
        const file = await storage.searchPublicObject(filePath);
        if (!file) return res.status(404).json({ detail: "Not found" });

        const response = await storage.downloadObject(file, 86400);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.status(response.status);
        const buffer = Buffer.from(await response.arrayBuffer());
        return res.send(buffer);
      } catch (err: any) {
        if (err instanceof ObjectNotFoundError) {
          return res.status(404).json({ detail: "Not found" });
        }
        clog.error("[PublicObjects] Error:", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION (TWILIO) ====================

  app.post(
    "/api/phone-verification/send",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { phone } = req.body;
        if (!phone)
          return res.status(400).json({ detail: "Phone number is required" });
        const cleanPhone = phone.replace(/\s+/g, "");
        if (!/^\+\d{10,15}$/.test(cleanPhone)) {
          return res.status(400).json({
            detail:
              "Invalid phone number format. Use international format: +201234567890",
          });
        }
        const result = await sendVerificationCode(cleanPhone);
        if (result.success) {
          return res.json({
            message: "Verification code sent",
            phone: cleanPhone,
          });
        }
        return res
          .status(500)
          .json({ detail: result.error || "Failed to send verification code" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.post(
    "/api/phone-verification/verify",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { phone, code } = req.body;
        if (!phone || !code)
          return res
            .status(400)
            .json({ detail: "Phone and code are required" });
        const result = verifyCode(phone, code);
        if (result.valid) {
          const userId = (req as any).user?.id;
          if (userId) {
            await query(
              "UPDATE users SET phone = $1, phone_verified = true WHERE id = $2",
              [phone, userId],
            );
          }
          return res.json({
            verified: true,
            message: "Phone verified successfully",
          });
        }
        return res
          .status(400)
          .json({ detail: result.error || "Invalid verification code" });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== TRUECALLER PHONE VERIFICATION ====================
  // Flow: deep link → opens Truecaller app → user approves → Truecaller POSTs to our callback
  // Reference: https://developer.truecaller.com/

  const truecallerSessions: Record<
    string,
    {
      userId?: number;
      phone: string;
      verified: boolean;
      rejected?: boolean;
      flowInvoked?: boolean;
      error?: string;
      name?: string;
      email?: string;
      avatarUrl?: string;
      createdAt: number;
    }
  > = {};

  setInterval(() => {
    const now = Date.now();
    for (const k of Object.keys(truecallerSessions)) {
      if (now - truecallerSessions[k].createdAt > 10 * 60 * 1000)
        delete truecallerSessions[k];
    }
  }, 60000);

  // Step 1: Generate deep link that opens Truecaller app on mobile
  app.post(
    "/api/phone-verification/truecaller-init",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const appKey = process.env.TRUECALLER_APP_KEY;
        if (!appKey)
          return res.status(503).json({ detail: "Truecaller not configured" });

        const userId = (req as any).user?.id;
        // requestNonce must be 8–64 chars, used to correlate callback
        const requestNonce = `ghazaly_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

        truecallerSessions[requestNonce] = {
          userId,
          phone: "",
          verified: false,
          createdAt: Date.now(),
        };

        const domain =
          req.headers.host || process.env.REPL_SLUG || "localhost:5000";
        const protocol =
          domain.includes("replit.dev") || domain.includes("replit.app")
            ? "https"
            : "http";
        const privacyUrl = encodeURIComponent(
          `${protocol}://${domain}/privacy`,
        );
        const termsUrl = encodeURIComponent(`${protocol}://${domain}/terms`);
        const appName = encodeURIComponent("Al-Ghazaly Auto Parts");

        // Truecaller deep link — opens app's bottom sheet on mobile
        const deep_link =
          `truecallersdk://truesdk/web_verify?type=btmsheet` +
          `&requestNonce=${requestNonce}` +
          `&partnerKey=${appKey}` +
          `&partnerName=${appName}` +
          `&lang=ar` +
          `&privacyUrl=${privacyUrl}` +
          `&termsUrl=${termsUrl}`;

        return res.json({ deep_link, state: requestNonce });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Step 2: Poll for verification status (frontend polls every 3s, up to 5 cycles as per Truecaller docs)
  app.get(
    "/api/phone-verification/truecaller-status/:state",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const state = String(req.params.state);
        const session = truecallerSessions[state];
        if (!session)
          return res
            .status(404)
            .json({ detail: "Session not found or expired" });
        return res.json({
          verified: session.verified,
          rejected: session.rejected || false,
          flow_invoked: session.flowInvoked || false,
          phone: session.verified ? session.phone : undefined,
          name: session.verified ? session.name : undefined,
          error: session.error,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Step 3: Truecaller POSTs here — handles 3 callback types:
  //   A) Handshake:    { requestId, status: "flow_invoked" }
  //   B) User profile: { requestId, accessToken, endpoint }
  //   C) User rejected:{ requestId, status: "user_rejected" }
  app.post(
    "/api/auth/truecaller/callback",
    async (req: Request, res: Response) => {
      try {
        const { requestId, accessToken, endpoint, status } = req.body;
        clog.info(
          "[Truecaller] Callback —",
          JSON.stringify({
            requestId,
            status,
            endpoint: endpoint?.slice(0, 50),
          }),
        );

        // Always acknowledge immediately with 200 (Truecaller requires 2XX)
        // A) Handshake: flow invoked — just acknowledge
        if (status === "flow_invoked") {
          clog.info(
            "[Truecaller] Handshake received for requestId:",
            requestId,
          );
          const session = truecallerSessions[requestId];
          if (session) session.flowInvoked = true;
          return res.status(200).json({ status: "acknowledged" });
        }

        // C) User rejected
        if (status === "user_rejected") {
          clog.info("[Truecaller] User rejected for requestId:", requestId);
          const session = truecallerSessions[requestId];
          if (session) session.rejected = true;
          return res.status(200).json({ status: "acknowledged" });
        }

        // B) Profile callback — fetch and process
        const session = truecallerSessions[requestId];
        if (!session) {
          clog.error("[Truecaller] Unknown requestId:", requestId);
          return res.status(200).json({ status: "unknown_request" }); // Still 200 to acknowledge
        }

        if (!accessToken || !endpoint) {
          clog.error("[Truecaller] Missing accessToken or endpoint");
          return res.status(200).json({ status: "missing_fields" });
        }

        // Fetch user profile from Truecaller's dynamic profile endpoint
        const profileRes = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Cache-Control": "no-cache",
          },
        });

        if (!profileRes.ok) {
          const errText = await profileRes.text();
          clog.error(
            "[Truecaller] Profile fetch failed:",
            profileRes.status,
            errText,
          );
          session.error = `Profile fetch failed: ${profileRes.status}`;
          return res.status(200).json({ status: "profile_fetch_failed" });
        }

        const profile = (await profileRes.json()) as any;
        clog.info("[Truecaller] Profile received:", JSON.stringify(profile));

        // phoneNumbers is an array per the docs: ["919999999999"]
        const rawPhone = Array.isArray(profile.phoneNumbers)
          ? profile.phoneNumbers[0]
          : profile.phoneNumber || profile.phone_number || "";

        // Ensure E.164 format (add + if missing)
        const verifiedPhone =
          rawPhone && !rawPhone.startsWith("+") ? `+${rawPhone}` : rawPhone;

        session.verified = true;
        session.phone = verifiedPhone;
        session.name =
          [profile.name?.first, profile.name?.last].filter(Boolean).join(" ") ||
          "";
        session.email = profile.onlineIdentities?.email || "";
        session.avatarUrl = profile.avatarUrl || "";

        // Persist to database
        if (session.userId) {
          const updates: string[] = [];
          const values: any[] = [];
          let idx = 1;
          if (verifiedPhone) {
            updates.push(`phone = $${idx++}`);
            values.push(verifiedPhone);
          }
          updates.push(`phone_verified = $${idx++}`);
          values.push(true);
          if (session.name) {
            updates.push(`name = $${idx++}`);
            values.push(session.name);
          }
          if (session.avatarUrl) {
            updates.push(`avatar_url = $${idx++}`);
            values.push(session.avatarUrl);
          }
          values.push(session.userId);
          await query(
            `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
            values,
          );
          clog.info(
            "[Truecaller] DB updated for userId:",
            session.userId,
            "phone:",
            verifiedPhone,
          );
        }

        return res.status(200).json({ success: true });
      } catch (err: any) {
        clog.error("[Truecaller] Callback error:", err);
        // Always return 200 to avoid Truecaller retrying
        return res.status(200).json({ error: err.message });
      }
    },
  );

  // ==================== SUBSCRIPTION STATUS ====================

  app.get("/api/subscription-status", async (req: Request, res: Response) => {
    try {
      const { email, phone } = req.query;
      if (!email && !phone) {
        return res.json({
          is_subscriber: false,
          has_pending: false,
          status: "free",
        });
      }

      // Check subscribers table first
      let subResult;
      if (email) {
        subResult = await query(
          "SELECT id, subscription_type FROM subscribers WHERE email = $1 AND deleted_at IS NULL",
          [email],
        );
      } else {
        subResult = await query(
          "SELECT id, subscription_type FROM subscribers WHERE phone = $1 AND deleted_at IS NULL",
          [phone],
        );
      }

      if (subResult.rows.length > 0) {
        const sub = subResult.rows[0];
        return res.json({
          is_subscriber: true,
          has_pending: false,
          status: "subscriber",
          subscription_type: sub.subscription_type,
        });
      }

      // Check subscription_requests table for pending
      let reqResult;
      if (email) {
        reqResult = await query(
          "SELECT id, status FROM subscription_requests WHERE user_email = $1 ORDER BY created_at DESC LIMIT 1",
          [email],
        );
      } else {
        reqResult = await query(
          "SELECT id, status FROM subscription_requests WHERE user_phone = $1 ORDER BY created_at DESC LIMIT 1",
          [phone],
        );
      }

      if (reqResult && reqResult.rows.length > 0) {
        const req_ = reqResult.rows[0];
        if (req_.status === "approved") {
          return res.json({
            is_subscriber: true,
            has_pending: false,
            status: "approved",
          });
        } else if (req_.status === "pending") {
          return res.json({
            is_subscriber: false,
            has_pending: true,
            status: "pending",
          });
        }
      }

      return res.json({
        is_subscriber: false,
        has_pending: false,
        status: "free",
      });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== CUSTOMERS (ADMIN/OWNER) ====================

  app.post(
    "/api/customers/admin/create",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { email, password, name, phone } = req.body;
        if (!email || !password || !name) {
          return res
            .status(400)
            .json({ detail: "Email, password and name are required" });
        }
        const existing = await query("SELECT id FROM users WHERE email = $1", [
          email.toLowerCase(),
        ]);
        if (existing.rows.length > 0) {
          return res.status(400).json({ detail: "Email already registered" });
        }
        const passwordHash = await hashPassword(password);
        const userId = genId();
        await query(
          "INSERT INTO users (id, email, name, password_hash, phone, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
          [
            userId,
            email.toLowerCase(),
            name,
            passwordHash,
            phone || null,
          ],
        );
        const userResult = await query(
          "SELECT " + SAFE_ADMIN_USER_COLUMNS + " FROM users WHERE id = $1",
          [userId],
        );
        const user = userResult.rows[0];
        const userSerialized = await serializeUser(user);
        userSerialized.role = "customer";
        return res.json({ user: userSerialized });
      } catch (err: any) {
        clog.error("Admin create customer error:", err);
        return res.status(500).json({ detail: "Failed to create customer" });
      }
    },
  );

  app.get(
    "/api/customers",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const callerRole = (req as any).userRole as string;
        const callerEmail: string = (req as any).user?.email || '';

        // Partners are restricted to customers who have ordered from their restaurant.
        let partnerRestaurantClause = '';
        const queryParams: any[] = [];
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId(callerEmail);
          if (!restaurantId) {
            return res.json({ customers: [], total: 0 });
          }
          queryParams.push(restaurantId);
          partnerRestaurantClause = `
            AND EXISTS (
              SELECT 1 FROM orders o_scope
              JOIN LATERAL (
                SELECT (item->>'product_id')::uuid AS pid
                FROM jsonb_array_elements(o_scope.items) AS item
                WHERE item->>'product_id' IS NOT NULL
              ) oi_scope ON TRUE
              JOIN products p_scope ON p_scope.id = oi_scope.pid
              WHERE o_scope.user_id = u.id
                AND o_scope.deleted_at IS NULL
                AND p_scope.car_model_ids @> jsonb_build_array($1::text)
            )`;
        }

        // Base columns follow SAFE_ADMIN_USER_COLUMNS (see server-auth.ts:safeAdminUserColumns).
        // Any future field additions/removals to that constant must be reflected here too.
        const result = await query(
          `SELECT ${safeAdminUserColumns('u')},
         (EXISTS(SELECT 1 FROM owners o2 WHERE LOWER(o2.email) = LOWER(u.email) AND o2.deleted_at IS NULL)) as is_owner,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL)::int as orders_count,
         (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as total_spent,
         (SELECT COUNT(*) FROM favorites f WHERE f.user_id = u.id) as favorites_count,
         (SELECT COUNT(*) FROM cart_items ci WHERE ci.user_id = u.id) as cart_count,
         (SELECT pr.id FROM password_requests pr WHERE pr.user_id = u.id AND pr.status = 'pending' ORDER BY pr.created_at DESC LIMIT 1) as password_request_id,
         (SELECT o.status FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL AND o.status IN ('pending','confirmed','preparing','shipped','out_for_delivery') ORDER BY o.created_at DESC LIMIT 1) as active_order_status,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL AND o.status IN ('pending','confirmed','preparing','shipped','out_for_delivery'))::int as active_orders_count
         FROM users u
         WHERE u.deleted_at IS NULL${partnerRestaurantClause}
         ORDER BY u.created_at DESC`,
          queryParams,
        );
        return res.json({ customers: result.rows, total: result.rows.length });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== FORGOT PASSWORD REQUEST ====================
  app.post("/api/auth/forgot-password", async (req: Request, res: Response) => {
    try {
      const { identifier } = req.body;
      if (!identifier)
        return res.status(400).json({ detail: "Email or phone required" });
      const isEmail = identifier.includes("@");
      let userResult;
      if (isEmail) {
        userResult = await query(
          "SELECT id, email, phone, phone_verified FROM users WHERE email = $1 AND deleted_at IS NULL",
          [identifier.toLowerCase()],
        );
      } else {
        userResult = await query(
          "SELECT id, email, phone, phone_verified FROM users WHERE phone = $1 AND deleted_at IS NULL",
          [identifier],
        );
      }
      if (userResult.rows.length === 0) {
        return res
          .status(404)
          .json({ detail: "No account found with this email or phone" });
      }
      const user = userResult.rows[0];
      const reqId = `pr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await query(
        "INSERT INTO password_requests (id, user_id, email, phone, status) VALUES ($1, $2, $3, $4, 'pending')",
        [reqId, user.id, user.email, user.phone || identifier],
      );
      return res.json({ success: true, message: "Password request submitted" });
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  // ==================== ADMIN: DISMISS PASSWORD REQUEST ====================
  app.delete(
    "/api/admin/password-requests/:id",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        await query(
          "UPDATE password_requests SET status = 'dismissed' WHERE id = $1",
          [req.params.id],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ADMIN: SET USER PASSWORD ====================
  app.post(
    "/api/admin/set-user-password",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId, password } = req.body;
        if (!userId || !password)
          return res
            .status(400)
            .json({ detail: "userId and password required" });
        if (password.length < 6)
          return res
            .status(400)
            .json({ detail: "Password must be at least 6 characters" });
        const newHash = await hashPassword(password);
        await query(
          "UPDATE users SET password_hash = $1, owner_temp_password = NULL, updated_at = NOW() WHERE id = $2",
          [newHash, userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== ADMIN: NOTIFY USER ====================
  app.post(
    "/api/admin/notify-user",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId, title, title_ar, message, message_ar, metadata } =
          req.body;
        if (!userId || !title || !message)
          return res
            .status(400)
            .json({ detail: "userId, title, and message required" });

        // Partners may only notify customers in their restaurant's scope.
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(userId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }
        const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await query(
          "INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,metadata) VALUES ($1,$2,$3,$4,$5,$6,'info',$7)",
          [
            notifId,
            userId,
            title,
            title_ar || title,
            message,
            message_ar || message,
            JSON.stringify(metadata || {}),
          ],
        );
        broadcastToUser(userId, {
          type: "notification",
          data: {
            id: notifId,
            title,
            title_ar: title_ar || title,
            message,
            message_ar: message_ar || message,
            type: "info",
          },
        });
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION: SUBMIT WHATSAPP ====================
  app.post(
    "/api/phone-verification/submit-whatsapp",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const { phone } = req.body;
        if (!phone)
          return res.status(400).json({ detail: "Phone number required" });
        const userId = (req as any).user?.id;
        await query(
          "UPDATE users SET pending_phone = $1, updated_at = NOW() WHERE id = $2",
          [phone, userId],
        );
        return res.json({
          success: true,
          whatsapp_number: "+0201011033571",
          message: "قم بالتحقق من رقم الموبيل",
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION: OWNER CONFIRM ====================
  app.post(
    "/api/phone-verification/owner-confirm",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ detail: "userId required" });
        const userRes = await query(
          "SELECT pending_phone FROM users WHERE id = $1",
          [userId],
        );
        if (!userRes.rows[0]?.pending_phone)
          return res.status(400).json({ detail: "No pending phone" });
        await query(
          "UPDATE users SET phone = pending_phone, phone_verified = true, pending_phone = NULL, updated_at = NOW() WHERE id = $1",
          [userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PHONE VERIFICATION: OWNER REJECT ====================
  app.post(
    "/api/phone-verification/owner-reject",
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ detail: "userId required" });
        await query(
          "UPDATE users SET pending_phone = NULL, updated_at = NOW() WHERE id = $1",
          [userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  app.get(
    "/api/customers/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const custId = String(req.params.id);
        const isValidUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            custId,
          );
        if (!isValidUUID)
          return res.status(400).json({ detail: "Invalid customer ID" });

        // Partners may only access customers who have ordered from their restaurant.
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(custId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }

        const result = await query(
          `SELECT ${safeAdminUserColumns('u')},
                  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as orders_count,
                  (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as total_spent
           FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [req.params.id],
        );
        if (result.rows.length === 0)
          return res.status(404).json({ detail: "Customer not found" });
        return res.json(result.rows[0]);
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Aggregated profile bundle — profile + favorites + cart + orders
  // Single round-trip used by the admin customer profile view to render all
  // tab content at once. Sub-resource endpoints below stay for compatibility.
  app.get(
    "/api/customers/admin/customer/:userId/profile-bundle",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      const t0 = Date.now();
      try {
        const userIdParam = req.params.userId;
        const userId = Array.isArray(userIdParam) ? userIdParam[0] : userIdParam;
        const isValidUUID =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            userId,
          );
        if (!isValidUUID)
          return res.status(400).json({ detail: "Invalid customer ID" });

        // Partners may only access customers who have ordered from their restaurant.
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(userId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }

        const [profileRes, favoritesRes, cartRes, ordersRes] =
          await Promise.all([
            query(
              `SELECT ${safeAdminUserColumns('u')},
                      (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as orders_count,
                      (SELECT COALESCE(SUM(o.total_amount), 0) FROM orders o WHERE o.user_id = u.id AND o.deleted_at IS NULL) as total_spent
               FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
              [userId],
            ),
            query(
              `SELECT f.*, p.name, p.name_ar, p.price::float as price, p.images, p.sku, p.image_url
               FROM favorites f
               JOIN products p ON p.id = f.product_id
               WHERE f.user_id = $1 AND p.deleted_at IS NULL
               ORDER BY f.created_at DESC`,
              [userId],
            ),
            query(
              `SELECT ci.*, p.name, p.name_ar, p.price::float as price, p.images, p.sku, p.image_url
               FROM cart_items ci
               JOIN products p ON p.id = ci.product_id
               WHERE ci.user_id = $1 AND p.deleted_at IS NULL
               ORDER BY ci.created_at DESC`,
              [userId],
            ),
            query(
              `SELECT o.id, o.order_number, o.status, o.total_amount::float as total_amount,
                      o.shipping_cost::float as shipping_cost,
                      o.payment_method, o.notes, o.created_at, o.updated_at, o.admin_viewed,
                      o.first_name, o.last_name, o.email, o.phone,
                      o.street_address, o.city, o.state, o.country,
                      o.delivery_instructions,
                      o.items
               FROM orders o
               WHERE o.user_id = $1::uuid AND o.deleted_at IS NULL
               ORDER BY o.created_at DESC`,
              [userId],
            ),
          ]);

        if (profileRes.rows.length === 0)
          return res.status(404).json({ detail: "Customer not found" });

        const elapsedMs = Date.now() - t0;
        clog.info(
          `[ProfileBundle] user=${userId} fav=${favoritesRes.rows.length} cart=${cartRes.rows.length} orders=${ordersRes.rows.length} in ${elapsedMs}ms`,
        );

        return res.json({
          profile: profileRes.rows[0],
          favorites: favoritesRes.rows,
          cart: cartRes.rows,
          orders: ordersRes.rows.map((o: any) => ({
            ...o,
            items: o.items || [],
          })),
          server_timing_ms: elapsedMs,
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Get customer favorites
  app.get(
    "/api/customers/admin/customer/:userId/favorites",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const userId = String(req.params.userId);
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(userId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }
        const result = await query(
          `SELECT
             f.*,
             p.name, p.name_ar, p.description, p.description_ar,
             p.price::float AS price, p.images, p.sku, p.image_url,
             p.stock_quantity, p.fitment_indicator, p.calories,
             p.car_model_ids, p.category_id,
             pb.name_ar AS product_brand_name,
             pb.name    AS product_brand_name_en,
             c.name_ar  AS category_name_ar,
             c.name     AS category_name_en
           FROM favorites f
           JOIN products p ON p.id = f.product_id
           LEFT JOIN product_brands pb ON pb.id = p.product_brand_id AND pb.deleted_at IS NULL
           LEFT JOIN categories c ON c.id = p.category_id
           WHERE f.user_id = $1 AND p.deleted_at IS NULL
           ORDER BY f.created_at DESC`,
          [userId],
        );
        return res.json({ favorites: result.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Get customer cart
  app.get(
    "/api/customers/admin/customer/:userId/cart",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const userId = String(req.params.userId);
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(userId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }
        const result = await query(
          `SELECT ci.*, p.name, p.name_ar, p.price::float as price, p.images, p.sku, p.image_url
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.user_id = $1 AND p.deleted_at IS NULL
         ORDER BY ci.created_at DESC`,
          [userId],
        );
        return res.json({ cart: result.rows });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Get customer orders
  app.get(
    "/api/customers/admin/customer/:userId/orders",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const userId = String(req.params.userId);
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(userId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }
        const result = await query(
          `SELECT o.id, o.order_number, o.status, o.total_amount::float as total_amount, 
                o.shipping_cost::float as shipping_cost,
                o.payment_method, o.notes, o.created_at, o.updated_at, o.admin_viewed,
                o.first_name, o.last_name, o.email, o.phone,
                o.street_address, o.city, o.state, o.country,
                o.delivery_instructions,
                o.items
         FROM orders o
         WHERE o.user_id = $1::uuid AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC`,
          [userId],
        );
        return res.json({
          orders: result.rows.map((o: any) => ({ ...o, items: o.items || [] })),
        });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // Admin: Mark customer orders as viewed
  app.patch(
    "/api/customers/admin/customer/:userId/orders/mark-viewed",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const userId = String(req.params.userId);
        const callerRole = (req as any).userRole as string;
        if (callerRole === 'partner') {
          const restaurantId = await getPartnerRestaurantId((req as any).user?.email || '');
          if (!restaurantId) return res.status(403).json({ detail: "Partner not assigned to a restaurant" });
          const inScope = await customerBelongsToRestaurant(userId, restaurantId);
          if (!inScope) return res.status(403).json({ detail: "Customer not in your restaurant's scope" });
        }
        await query(
          `UPDATE orders SET admin_viewed = true WHERE user_id = $1 AND admin_viewed = false`,
          [userId],
        );
        return res.json({ success: true });
      } catch (err: any) {
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== VERSION & HEALTH ====================

  app.get("/api/version", (req: Request, res: Response) => {
    return res.json({
      api_version: "4.2.0",
      build_date: new Date().toISOString().split("T")[0],
      min_frontend_version: "1.0.0",
      features: [
        "auth",
        "products",
        "cart",
        "orders",
        "admin",
        "analytics",
        "sync",
      ],
    });
  });

  // Root route — required for Replit port detection
  app.get("/", (_req: Request, res: Response) => {
    res.json({ service: "Al-GhazalyParts API", status: "ok" });
  });

  app.get("/api/health", async (req: Request, res: Response) => {
    try {
      await query("SELECT 1");
      return res.json({
        status: "healthy",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      return res
        .status(500)
        .json({ status: "unhealthy", database: "disconnected" });
    }
  });

  // Alias for production health check path
  app.get("/api/healthz", async (_req: Request, res: Response) => {
    try {
      await query("SELECT 1");
      return res.json({ status: "ok" });
    } catch {
      return res.status(500).json({ status: "error" });
    }
  });

  // ==================== COLLECTIONS ====================

  app.get("/api/collections", async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT * FROM car_brands WHERE deleted_at IS NULL ORDER BY name`,
      );
      return res.json(result.rows);
    } catch (err: any) {
      return res.status(500).json({ detail: err.message });
    }
  });

  const httpServer = createServer(app);

  // ==================== CHAT & AI AGENT ROUTES ====================
  app.use("/api", createChatRouter(broadcastToUser));
  app.use("/api", createKnowledgeBaseRouter(broadcastToUsers));
  app.use("/api/appointments", createAppointmentsRouter());
  app.use("/api", createAiRouter());
  app.use("/api/restaurant-analytics", createRestaurantAnalyticsRouter(broadcastToAll, broadcastToUser));

  // ==================== OBJECT STORAGE SERVING ====================
  // Use app.use to capture nested paths like /api/storage/objects/uploads/<uuid>
  app.use(
    "/api/storage/objects",
    requireAuth as any,
    async (req: Request, res: Response, next: any) => {
      if (req.method !== "GET") return next();
      try {
        // req.path will be e.g. /uploads/<uuid>
        const objectPath = `/objects${req.path}`;
        const user = (req as any).user;
        const storage = new ObjectStorageService();
        const objectFile = await storage.getObjectEntityFile(objectPath);

        // Enforce ACL: check if the authenticated user can access this object.
        // Admin and owner roles can access any private object (for KB management).
        // For all others, use canAccessObject which checks ownership and visibility.
        const userRole = user?.email ? await getUserRole(user.email) : null;
        const isPrivileged = userRole === "admin" || userRole === "owner";
        const hasAccess = isPrivileged || (await canAccessObject({
          userId: user?.id,
          objectFile,
          requestedPermission: ObjectPermission.READ,
        }));
        if (!hasAccess) {
          return res.status(403).json({ detail: "Access denied" });
        }

        const response = await storage.downloadObject(objectFile);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.status(response.status);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      } catch (err: any) {
        if (err instanceof ObjectNotFoundError) {
          return res.status(404).json({ detail: "File not found" });
        }
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==================== PUBLIC MEDIA SERVING ====================
  // Serves objects from the private dir that have been explicitly set to public ACL
  // via POST /api/finalize-upload. No auth required — ACL check enforces visibility.
  // URL pattern: /api/media/<uuid> → objectPath /objects/uploads/<uuid>
  app.use(
    "/api/media",
    async (req: Request, res: Response, next: any) => {
      if (req.method !== "GET") return next();
      try {
        const privateDirSet = !!process.env.PRIVATE_OBJECT_DIR;
        if (!privateDirSet) {
          return res.status(503).json({ detail: "Object Storage not configured" });
        }
        // req.path = /uploads/<uuid> (as returned by /api/finalize-upload's servingUrl)
        // objectPath = /objects/uploads/<uuid> — matches getObjectEntityFile contract
        const objectPath = `/objects${req.path}`;
        const storage = new ObjectStorageService();
        const objectFile = await storage.getObjectEntityFile(objectPath);

        const { getObjectAclPolicy } = await import("./lib/objectAcl");
        const aclPolicy = await getObjectAclPolicy(objectFile);
        if (!aclPolicy || aclPolicy.visibility !== "public") {
          return res.status(403).json({ detail: "Access denied" });
        }

        const response = await storage.downloadObject(objectFile, 86400);
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.status(response.status);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
      } catch (err: any) {
        if (err instanceof ObjectNotFoundError) {
          return res.status(404).json({ detail: "File not found" });
        }
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ==========================================
  // WebSocket Server (Real-time Notifications)
  // ==========================================
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, userId?: string) => {
    if (userId) {
      if (!wsClients.has(userId)) wsClients.set(userId, new Set());
      wsClients.get(userId)!.add(ws);
      clog.info(
        `[WS] Client connected: user=${userId}, total=${wsClients.get(userId)!.size}`,
      );
    } else {
      wsAnonClients.add(ws);
      clog.info(
        `[WS] Anonymous client connected, total=${wsAnonClients.size}`,
      );
    }

    ws.send(
      JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }),
    );

    ws.on("message", (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === "ping") {
          ws.send(
            JSON.stringify({
              type: "pong",
              timestamp: new Date().toISOString(),
            }),
          );
        }
        // Note: userId is bound from session cookie at connect time (not from client messages)
      } catch {}
    });

    ws.on("close", () => {
      if (userId) {
        const userSet = wsClients.get(userId);
        if (userSet) {
          userSet.delete(ws);
          if (userSet.size === 0) wsClients.delete(userId);
        }
      } else {
        wsAnonClients.delete(ws);
      }
      clog.info(`[WS] Client disconnected`);
    });

    ws.on("error", (err) => {
      clog.error("[WS] Socket error:", err.message);
    });
  });

  // ── Order Ratings ─────────────────────────────────────────────────────────
  // Init table idempotently on startup (called from setupRoutes below)
  async function initOrderRatingsTable() {
    await query(`
      CREATE TABLE IF NOT EXISTS order_ratings (
        id UUID NOT NULL DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        user_id UUID NOT NULL,
        restaurant_id UUID,
        rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT,
        user_name VARCHAR(255),
        admin_reply TEXT,
        admin_reply_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        PRIMARY KEY (id)
      )
    `);
    await query(`ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS admin_reply TEXT`).catch(() => {});
    await query(`ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS admin_reply_at TIMESTAMP WITH TIME ZONE`).catch(() => {});
    // Migrate: drop legacy single-row unique constraint and replace with
    // two partial unique indexes — one per restaurant, one for null restaurant —
    // so the user can submit a separate rating for each restaurant in an order.
    await query(`ALTER TABLE order_ratings DROP CONSTRAINT IF EXISTS order_ratings_order_id_user_id_key`).catch(() => {});
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS order_ratings_with_restaurant_uq
        ON order_ratings (order_id, user_id, restaurant_id)
        WHERE restaurant_id IS NOT NULL
    `).catch(() => {});
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS order_ratings_null_restaurant_uq
        ON order_ratings (order_id, user_id)
        WHERE restaurant_id IS NULL
    `).catch(() => {});
    await query(`
      CREATE INDEX IF NOT EXISTS idx_order_ratings_restaurant
        ON order_ratings (restaurant_id, created_at DESC)
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_order_ratings_created
        ON order_ratings (created_at DESC)
    `);
    // FK: order_ratings.order_id → orders(id) ON DELETE CASCADE
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'order_ratings_order_id_fkey'
        ) THEN
          ALTER TABLE order_ratings
            ADD CONSTRAINT order_ratings_order_id_fkey
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
        END IF;
      END $$
    `).catch(() => { /* orders table may not exist in test envs — skip */ });
    // FK: order_ratings.user_id → users(id) ON DELETE CASCADE
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'order_ratings_user_id_fkey'
        ) THEN
          ALTER TABLE order_ratings
            ADD CONSTRAINT order_ratings_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$
    `).catch(() => { /* users table may not exist in test envs — skip */ });
    // FK: order_ratings.restaurant_id → car_models(id) ON DELETE SET NULL
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'order_ratings_restaurant_id_fkey'
        ) THEN
          ALTER TABLE order_ratings
            ADD CONSTRAINT order_ratings_restaurant_id_fkey
            FOREIGN KEY (restaurant_id) REFERENCES car_models(id) ON DELETE SET NULL;
        END IF;
      END $$
    `).catch(() => { /* car_models table may not exist in test envs — skip */ });
  }
  await initOrderRatingsTable().catch((e) =>
    clog.warn("[initOrderRatingsTable] skipped:", e.message),
  );

  // GET /api/ratings/check/:orderId — check whether current user has already rated an order
  app.get("/api/ratings/check/:orderId", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req as any);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });
      const { orderId } = req.params;
      const result = await query(
        `SELECT id, rating FROM order_ratings WHERE order_id = $1 AND user_id = $2 LIMIT 1`,
        [orderId, user.id],
      );
      const row = result.rows[0] ?? null;
      return res.json({ rated: !!row, rating: row?.rating ?? null });
    } catch (err: any) {
      clog.error("[GET /api/ratings/check]", err.message);
      return res.status(500).json({ detail: err.message });
    }
  });

  // POST /api/ratings — submit rating (auth required, one row per restaurant in order, delivered orders only)
  app.post("/api/ratings", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req as any);
      if (!user) return res.status(401).json({ detail: "Unauthorized" });
      const { order_id, rating, comment } = req.body ?? {};
      if (!order_id || !rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ detail: "order_id and rating (1-5) are required" });
      }
      // Fetch order + all distinct restaurant_ids from products.car_model_ids (JSONB array)
      const orderCheck = await query(
        `SELECT o.id, o.user_id, o.status,
                ARRAY(
                  SELECT DISTINCT cm_id::uuid
                  FROM jsonb_array_elements(COALESCE(o.items, '[]'::jsonb)) AS item
                  JOIN products p ON p.id = (item->>'product_id')::uuid
                  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(p.car_model_ids, '[]'::jsonb)) AS cm_id
                  WHERE cm_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    AND EXISTS (
                      SELECT 1 FROM car_models cm
                      WHERE cm.id = cm_id::uuid AND cm.deleted_at IS NULL
                    )
                ) AS restaurant_ids
         FROM orders o WHERE o.id=$1 AND o.deleted_at IS NULL LIMIT 1`,
        [order_id],
      );
      if (!orderCheck.rows.length) {
        return res.status(404).json({ detail: "order not found" });
      }
      const order = orderCheck.rows[0];
      // Strict ownership check
      if (!order.user_id) {
        return res.status(403).json({ detail: "this order has no registered owner and cannot be rated" });
      }
      if (order.user_id !== user.id) {
        return res.status(403).json({ detail: "not your order" });
      }
      if (!["delivered", "completed"].includes(order.status ?? "")) {
        return res.status(422).json({ detail: "ratings are only accepted for delivered orders" });
      }

      const restaurantIds: string[] = Array.isArray(order.restaurant_ids)
        ? order.restaurant_ids.filter(Boolean)
        : [];
      const insertedRows: any[] = [];
      const userName = user.name || null;
      const trimmedComment = comment?.trim() || null;

      if (restaurantIds.length === 0) {
        // No restaurant found in items — insert one null-restaurant row (upsert)
        const r = await query(
          `INSERT INTO order_ratings (order_id, user_id, restaurant_id, rating, comment, user_name)
           VALUES ($1, $2, NULL, $3, $4, $5)
           ON CONFLICT (order_id, user_id) WHERE restaurant_id IS NULL
           DO UPDATE SET rating = EXCLUDED.rating,
                         comment = EXCLUDED.comment,
                         user_name = EXCLUDED.user_name
           RETURNING *`,
          [order_id, user.id, rating, trimmedComment, userName],
        );
        if (r.rows[0]) insertedRows.push(r.rows[0]);
      } else {
        // Insert one rating row per distinct restaurant (upsert per restaurant)
        for (const rid of restaurantIds) {
          const r = await query(
            `INSERT INTO order_ratings (order_id, user_id, restaurant_id, rating, comment, user_name)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (order_id, user_id, restaurant_id) WHERE restaurant_id IS NOT NULL
             DO UPDATE SET rating = EXCLUDED.rating,
                           comment = EXCLUDED.comment,
                           user_name = EXCLUDED.user_name
             RETURNING *`,
            [order_id, user.id, rid, rating, trimmedComment, userName],
          );
          if (r.rows[0]) insertedRows.push(r.rows[0]);
        }
      }

      const primaryRow = insertedRows[0] ?? null;
      // Broadcast so real-time feeds (restaurant analytics, home ratings strip) update immediately
      for (const row of insertedRows) {
        broadcastToAll({ type: "rating_created", data: row });
      }
      return res.status(201).json(primaryRow);
    } catch (err: any) {
      clog.error("[POST /api/ratings]", err.message);
      return res.status(500).json({ detail: err.message });
    }
  });

  // GET /api/ratings/summary — batch avg+count per restaurant (no auth)
  app.get("/api/ratings/summary", async (req: Request, res: Response) => {
    try {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const MAX_IDS = 100;
      const ids = (req.query.restaurant_ids as string | undefined)?.split(",").filter(Boolean) ?? [];
      if (ids.length === 0) return res.json([]);
      if (ids.length > MAX_IDS) return res.status(400).json({ detail: `Too many restaurant_ids (max ${MAX_IDS})` });
      const invalid = ids.find((id) => !UUID_RE.test(id));
      if (invalid) return res.status(400).json({ detail: `Invalid UUID: ${invalid}` });
      const rows = await query(
        `SELECT restaurant_id,
                ROUND(AVG(rating)::numeric, 1)::float AS avg_rating,
                COUNT(*)::int AS review_count
         FROM order_ratings
         WHERE restaurant_id = ANY($1::uuid[])
         GROUP BY restaurant_id`,
        [ids],
      );
      return res.json(rows.rows);
    } catch (err: any) {
      clog.error("[GET /api/ratings/summary]", err.message);
      return res.status(500).json({ detail: err.message });
    }
  });

  // GET /api/ratings/distribution — star distribution counts (public, optionally scoped by restaurant)
  app.get("/api/ratings/distribution", async (req: Request, res: Response) => {
    try {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const restaurantId = req.query.restaurant_id as string | undefined;
      if (restaurantId !== undefined && !UUID_RE.test(restaurantId)) {
        return res.status(400).json({ detail: "Invalid restaurant_id: must be a UUID" });
      }
      const rows = await query(
        `SELECT
           rating::int AS star,
           COUNT(*)::int AS count
         FROM order_ratings
         WHERE ($1::uuid IS NULL OR restaurant_id = $1::uuid)
         GROUP BY rating
         ORDER BY rating DESC`,
        [restaurantId ?? null],
      );
      const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      let weightedSum = 0;
      for (const row of rows.rows) {
        const star = Number(row.star);
        const cnt = Number(row.count);
        dist[String(star)] = cnt;
        weightedSum += star * cnt;
      }
      const total = dist["1"] + dist["2"] + dist["3"] + dist["4"] + dist["5"];
      const average = total > 0 ? Math.round((weightedSum / total) * 10) / 10 : 0;
      return res.json({ "1": dist["1"], "2": dist["2"], "3": dist["3"], "4": dist["4"], "5": dist["5"], total, average });
    } catch (err: any) {
      clog.error("[GET /api/ratings/distribution]", err.message);
      return res.status(500).json({ detail: "Failed to load ratings distribution" });
    }
  });

  // GET /api/ratings — public recent ratings feed (joins restaurant name + full order_items array)
  app.get("/api/ratings", async (req: Request, res: Response) => {
    try {
      const ratingsFeedParams = GetRatingsQueryParams.safeParse(req.query);
      if (!ratingsFeedParams.success) {
        return res.status(400).json({ detail: "Invalid query parameters", errors: ratingsFeedParams.error.errors });
      }
      const { limit, restaurant_id: restaurantId } = ratingsFeedParams.data;
      const rows = await query(
        `SELECT r.id, r.rating, r.comment, r.user_name,
                r.restaurant_id, r.created_at,
                r.admin_reply, r.admin_reply_at,
                cm.name AS restaurant_name,
                cm.name_ar AS restaurant_name_ar,
                COALESCE((
                  SELECT COALESCE(
                    (
                      SELECT JSON_AGG(
                        JSON_BUILD_OBJECT(
                          'name',     COALESCE(p.name,    item->>'name'),
                          'name_ar',  COALESCE(p.name_ar, item->>'name_ar'),
                          'quantity', (item->>'quantity')::int,
                          'sku',      COALESCE(p.sku,     item->>'sku')
                        )
                        ORDER BY (item->>'quantity')::int DESC
                      )
                      FROM jsonb_array_elements(o.items) AS item
                      LEFT JOIN products p ON p.id = (
                        CASE WHEN (item->>'product_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN (item->>'product_id')::uuid ELSE NULL END
                      )
                    ),
                    '[]'::json
                  )
                  FROM orders o
                  WHERE o.id = r.order_id
                ), '[]'::json) AS order_items
         FROM order_ratings r
         LEFT JOIN car_models cm ON cm.id = r.restaurant_id
         WHERE ($1::uuid IS NULL OR r.restaurant_id = $1::uuid)
         ORDER BY r.created_at DESC
         LIMIT $2`,
        [restaurantId ?? null, limit],
      );
      return res.json(rows.rows);
    } catch (err: any) {
      clog.error("[GET /api/ratings]", err.message);
      return res.status(500).json({ detail: "Failed to load ratings" });
    }
  });

  // ── Admin Ratings ─────────────────────────────────────────────────────────

  // GET /api/admin/ratings — paginated, filterable ratings list + aggregate stats
  app.get(
    "/api/admin/ratings",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const callerRole = (req as any).userRole as string;
        const callerId  = (req as any).user?.id as string | undefined;

        const adminRatingsParams = GetAdminRatingsQueryParams.safeParse(req.query);
        if (!adminRatingsParams.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: adminRatingsParams.error.errors });
        }
        const { page, limit, restaurant_id, star } = adminRatingsParams.data;
        const offset = (page - 1) * limit;
        const restaurantId = restaurant_id ?? null;
        const starRating = star ?? null;

        // restaurant_user: scope to their assigned restaurants only.
        // They must also supply a restaurant_id that is in their assignment list.
        let allowedRestaurantIds: string[] | null = null;
        if (callerRole === "restaurant_user" && callerId) {
          const assignedRows = await query(
            `SELECT restaurant_id FROM restaurant_users WHERE user_id = $1`,
            [callerId],
          );
          allowedRestaurantIds = assignedRows.rows.map((r: any) => r.restaurant_id as string);
          if (allowedRestaurantIds.length === 0) {
            return res.json({ ratings: [], total: 0, page, limit, stats: null });
          }
          // If caller supplied a restaurant_id, verify it's in their set
          if (restaurantId && !allowedRestaurantIds.includes(restaurantId)) {
            return res.status(403).json({ detail: "Access denied: restaurant not in your assignments" });
          }
          // If no restaurant_id supplied, require one for restaurant_user
          if (!restaurantId) {
            return res.status(400).json({ detail: "restaurant_id is required for your role" });
          }
        }

        const rows = await query(
          `SELECT r.id, r.rating, r.comment, r.user_name, r.order_id,
                  r.restaurant_id, r.created_at,
                  r.admin_reply, r.admin_reply_at,
                  cm.name AS restaurant_name,
                  cm.name_ar AS restaurant_name_ar
           FROM order_ratings r
           LEFT JOIN car_models cm ON cm.id = r.restaurant_id
           WHERE ($1::uuid IS NULL OR r.restaurant_id = $1::uuid)
             AND ($2::smallint IS NULL OR r.rating = $2::smallint)
           ORDER BY r.created_at DESC
           LIMIT $3 OFFSET $4`,
          [restaurantId, starRating, limit, offset],
        );

        const countRow = await query(
          `SELECT COUNT(*) AS total
           FROM order_ratings r
           WHERE ($1::uuid IS NULL OR r.restaurant_id = $1::uuid)
             AND ($2::smallint IS NULL OR r.rating = $2::smallint)`,
          [restaurantId, starRating],
        );

        const statsRow = await query(
          `SELECT
             ROUND(AVG(r.rating)::numeric, 2) AS avg_rating,
             COUNT(*) AS total_count,
             SUM(CASE WHEN r.rating = 1 THEN 1 ELSE 0 END) AS star_1,
             SUM(CASE WHEN r.rating = 2 THEN 1 ELSE 0 END) AS star_2,
             SUM(CASE WHEN r.rating = 3 THEN 1 ELSE 0 END) AS star_3,
             SUM(CASE WHEN r.rating = 4 THEN 1 ELSE 0 END) AS star_4,
             SUM(CASE WHEN r.rating = 5 THEN 1 ELSE 0 END) AS star_5
           FROM order_ratings r
           WHERE ($1::uuid IS NULL OR r.restaurant_id = $1::uuid)
             AND ($2::smallint IS NULL OR r.rating = $2::smallint)`,
          [restaurantId, starRating],
        );

        return res.json({
          ratings: rows.rows,
          total: parseInt(String(countRow.rows[0]?.total ?? "0"), 10),
          page,
          limit,
          stats: statsRow.rows[0] ?? null,
        });
      } catch (err: any) {
        clog.error("[GET /api/admin/ratings]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/admin/ratings/export — stream CSV of all matching ratings (no pagination)
  app.get(
    "/api/admin/ratings/export",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const exportParams = GetAdminRatingsExportQueryParams.safeParse(req.query);
        if (!exportParams.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: exportParams.error.errors });
        }
        const { restaurant_id, star } = exportParams.data;
        const restaurantId = restaurant_id ?? null;
        const starRating = star ?? null;

        const rows = await query(
          `SELECT r.created_at, r.user_name, r.rating, r.comment,
                  cm.name AS restaurant_name
           FROM order_ratings r
           LEFT JOIN car_models cm ON cm.id = r.restaurant_id
           WHERE ($1::uuid IS NULL OR r.restaurant_id = $1::uuid)
             AND ($2::smallint IS NULL OR r.rating = $2::smallint)
           ORDER BY r.created_at DESC`,
          [restaurantId, starRating],
        );

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `ratings-${dateStr}.csv`;

        const escapeCsv = (val: string | null | undefined): string => {
          if (val == null) return "";
          let str = String(val);
          // Neutralise CSV formula injection: prefix any value that starts with
          // a spreadsheet formula trigger character with a single quote so that
          // Excel / Google Sheets treat it as plain text.
          if (/^[=+\-@\t\r]/.test(str)) {
            str = `'${str}`;
          }
          if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        };

        const header = "date,user,restaurant,stars,comment\r\n";
        const csvRows = rows.rows.map((r: any) => {
          const date = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : "";
          return [
            escapeCsv(date),
            escapeCsv(r.user_name),
            escapeCsv(r.restaurant_name),
            escapeCsv(String(r.rating ?? "")),
            escapeCsv(r.comment),
          ].join(",");
        });

        const csv = header + csvRows.join("\r\n");

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        return res.send(csv);
      } catch (err: any) {
        clog.error("[GET /api/admin/ratings/export]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // DELETE /api/admin/ratings/:id — remove a rating
  app.delete(
    "/api/admin/ratings/:id",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const id = String(req.params.id ?? "");
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(id)) {
          return res.status(400).json({ detail: "id must be a valid UUID" });
        }
        const result = await query(
          `DELETE FROM order_ratings WHERE id = $1 RETURNING id`,
          [id],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Rating not found" });
        }
        broadcastToAll({ type: "rating_deleted", data: { id } });
        return res.json({ ok: true, id });
      } catch (err: any) {
        clog.error("[DELETE /api/admin/ratings/:id]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PUT /api/admin/ratings/:id/reply — upsert admin reply on a rating
  app.put(
    "/api/admin/ratings/:id/reply",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const callerRole = (req as any).userRole as string;
        const callerId  = (req as any).user?.id as string | undefined;

        const id = String(req.params.id ?? "");
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(id)) {
          return res.status(400).json({ detail: "id must be a valid UUID" });
        }
        const reply = String(req.body?.reply ?? "").trim();
        if (!reply) {
          return res.status(400).json({ detail: "reply text is required" });
        }
        if (reply.length > 500) {
          return res.status(400).json({ detail: "reply must be 500 characters or fewer" });
        }
        // Fetch user_id and restaurant_id before updating
        const existing = await query(
          `SELECT user_id, restaurant_id FROM order_ratings WHERE id = $1`,
          [id],
        );
        if (existing.rows.length === 0) {
          return res.status(404).json({ detail: "Rating not found" });
        }
        const ratingUserId = existing.rows[0].user_id;
        const ratingRestaurantId = existing.rows[0].restaurant_id as string | null;

        // restaurant_user: verify they manage the restaurant this rating belongs to
        if (callerRole === "restaurant_user" && callerId) {
          if (!ratingRestaurantId) {
            return res.status(403).json({ detail: "Access denied: rating has no restaurant" });
          }
          const assignedRows = await query(
            `SELECT 1 FROM restaurant_users WHERE user_id = $1 AND restaurant_id = $2 LIMIT 1`,
            [callerId, ratingRestaurantId],
          );
          if (assignedRows.rows.length === 0) {
            return res.status(403).json({ detail: "Access denied: restaurant not in your assignments" });
          }
        }

        const result = await query(
          `UPDATE order_ratings
           SET admin_reply = $1, admin_reply_at = NOW()
           WHERE id = $2
           RETURNING id, admin_reply, admin_reply_at`,
          [reply, id],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Rating not found" });
        }
        // Insert an in-app notification for the rating author
        // rating_id is a first-class column (added via ALTER TABLE in migration.sql)
        const notifId = crypto.randomUUID();
        await query(
          `INSERT INTO notifications (id,user_id,title,title_ar,message,message_ar,type,rating_id,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,'rating_reply',$7,$8)
           ON CONFLICT DO NOTHING`,
          [
            notifId,
            ratingUserId,
            "The owner replied to your review",
            "أجاب المالك على تقييمك",
            reply.slice(0, 120),
            reply.slice(0, 120),
            id,
            JSON.stringify({ rating_id: id }),
          ],
        );
        // Targeted broadcast to the rating owner + all-admin broadcast
        broadcastToUser(ratingUserId, {
          type: "rating_reply_updated",
          data: { ...result.rows[0], rating_id: id },
        });
        broadcastToAll({ type: "rating_reply_updated", data: result.rows[0] });
        return res.json(result.rows[0]);
      } catch (err: any) {
        clog.error("[PUT /api/admin/ratings/:id/reply]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // DELETE /api/admin/ratings/:id/reply — clear admin reply from a rating
  app.delete(
    "/api/admin/ratings/:id/reply",
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const callerRole = (req as any).userRole as string;
        const callerId  = (req as any).user?.id as string | undefined;

        const id = String(req.params.id ?? "");
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!UUID_RE.test(id)) {
          return res.status(400).json({ detail: "id must be a valid UUID" });
        }

        // restaurant_user: verify they manage the restaurant this rating belongs to
        if (callerRole === "restaurant_user" && callerId) {
          const ratingRow = await query(
            `SELECT restaurant_id FROM order_ratings WHERE id = $1`,
            [id],
          );
          if (ratingRow.rows.length === 0) {
            return res.status(404).json({ detail: "Rating not found" });
          }
          const ratingRestaurantId = ratingRow.rows[0].restaurant_id as string | null;
          if (!ratingRestaurantId) {
            return res.status(403).json({ detail: "Access denied: rating has no restaurant" });
          }
          const assignedRows = await query(
            `SELECT 1 FROM restaurant_users WHERE user_id = $1 AND restaurant_id = $2 LIMIT 1`,
            [callerId, ratingRestaurantId],
          );
          if (assignedRows.rows.length === 0) {
            return res.status(403).json({ detail: "Access denied: restaurant not in your assignments" });
          }
        }

        const result = await query(
          `UPDATE order_ratings
           SET admin_reply = NULL, admin_reply_at = NULL
           WHERE id = $1
           RETURNING id`,
          [id],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ detail: "Rating not found" });
        }
        broadcastToAll({ type: "rating_reply_updated", data: { id, admin_reply: null, admin_reply_at: null } });
        return res.json({ ok: true, id });
      } catch (err: any) {
        clog.error("[DELETE /api/admin/ratings/:id/reply]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ── Excel Export → Google Drive ──────────────────────────────────────────
  app.post(
    "/api/orders/export-excel",
    requireAdminRole(["owner", "partner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { orders, startDate, endDate, statusFilter, language } = req.body;

        if (!Array.isArray(orders)) {
          return res.status(400).json({ error: "orders must be an array" });
        }

        const url = await generateAndUploadExcel(orders, {
          startDate,
          endDate,
          statusFilter,
          language: language || "ar",
        });

        return res.json({ url });
      } catch (err: any) {
        clog.error("[ExcelExport] Error:", err.message);
        return res.status(500).json({ error: err.message || "Export failed" });
      }
    },
  );

  // ── Push notification token registry ─────────────────────────────────────
  // POST /api/notifications/register-token — upsert an Expo push token for the
  // authenticated user. Called once on app startup after Notifications.getExpoPushTokenAsync().
  app.post(
    "/api/notifications/register-token",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const { token, platform } = req.body;
        if (!token || typeof token !== "string") {
          return res.status(400).json({ detail: "token is required" });
        }
        await query(
          `INSERT INTO expo_push_tokens (user_id, token, platform, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW()`,
          [user.id, token.trim(), platform ?? "expo"],
        );
        return res.json({ ok: true });
      } catch (err: any) {
        clog.error("[POST /api/notifications/register-token]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // DELETE /api/notifications/unregister-token — remove a push token on logout
  app.delete(
    "/api/notifications/unregister-token",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const { token } = req.body;
        if (!token || typeof token !== "string") {
          return res.status(400).json({ detail: "token is required" });
        }
        await query(
          `DELETE FROM expo_push_tokens WHERE user_id = $1 AND token = $2`,
          [user.id, token.trim()],
        );
        return res.json({ ok: true });
      } catch (err: any) {
        clog.error("[DELETE /api/notifications/unregister-token]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /api/push-tokens — alias for /api/notifications/register-token (spec contract)
  app.post(
    "/api/push-tokens",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const { token, platform } = req.body;
        if (!token || typeof token !== "string") {
          return res.status(400).json({ detail: "token is required" });
        }
        await query(
          `INSERT INTO expo_push_tokens (user_id, token, platform, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id, token) DO UPDATE SET updated_at = NOW()`,
          [user.id, token.trim(), platform ?? "expo"],
        );
        return res.json({ ok: true });
      } catch (err: any) {
        clog.error("[POST /api/push-tokens]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // DELETE /api/push-tokens — alias for /api/notifications/unregister-token (spec contract)
  app.delete(
    "/api/push-tokens",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const { token } = req.body;
        if (!token || typeof token !== "string") {
          return res.status(400).json({ detail: "token is required" });
        }
        await query(
          `DELETE FROM expo_push_tokens WHERE user_id = $1 AND token = $2`,
          [user.id, token.trim()],
        );
        return res.json({ ok: true });
      } catch (err: any) {
        clog.error("[DELETE /api/push-tokens]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // ── Push notification history log ─────────────────────────────────────────
  // GET /api/notifications/push-log — paginated log of dispatched push notifications
  app.get(
    "/api/notifications/push-log",
    requireAuth as any,
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const pushLogParams = GetPushLogQueryParams.safeParse(req.query);
        if (!pushLogParams.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: pushLogParams.error.errors });
        }
        const { page, limit, start_date, end_date, event_type, restaurant_id: rawRestaurantId, unread_only } = pushLogParams.data;
        const offset = (page - 1) * limit;

        let restaurant_id = rawRestaurantId;
        if ((req as any).userRole === "restaurant_user") {
          const ruRes = await query(
            `SELECT ru.restaurant_id FROM restaurant_users ru WHERE ru.user_id = $1 LIMIT 1`,
            [(req as any).user.id],
          );
          restaurant_id = ruRes.rows[0]?.restaurant_id ?? restaurant_id;
        }

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (start_date) {
          params.push(start_date);
          conditions.push(`sent_at >= $${params.length}`);
        }
        if (end_date) {
          params.push(end_date);
          conditions.push(`sent_at <= $${params.length}`);
        }
        if (event_type) {
          params.push(event_type);
          conditions.push(`event_type = $${params.length}`);
        }
        if (restaurant_id) {
          params.push(restaurant_id);
          conditions.push(`(payload->'restaurant_ids' @> jsonb_build_array($${params.length}::text) OR payload->>'restaurant_id' = $${params.length}::text)`);
        }
        if (unread_only === "true") {
          conditions.push(`acknowledged_at IS NULL`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        params.push(limit);
        params.push(offset);
        const dataResult = await query(
          `SELECT id, event_type, title, body, title_en, title_ar, body_en, body_ar,
                  payload, recipient_user_ids, recipient_count, sent_at, acknowledged_at
           FROM push_notification_log
           ${where}
           ORDER BY sent_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params,
        );

        const countParams = params.slice(0, params.length - 2);
        const countResult = await query(
          `SELECT COUNT(*) AS total FROM push_notification_log ${where}`,
          countParams,
        );
        const total = parseInt((countResult.rows[0] as { total: string }).total, 10);

        return res.json({
          data: dataResult.rows,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        });
      } catch (err: any) {
        clog.error("[GET /api/notifications/push-log]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/notifications/push-log/unread-count
  app.get(
    "/api/notifications/push-log/unread-count",
    requireAuth as any,
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const unreadCountParams = GetPushLogUnreadCountQueryParams.safeParse(req.query);
        if (!unreadCountParams.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: unreadCountParams.error.errors });
        }
        const { since, restaurant_id: rawRid, event_type } = unreadCountParams.data;
        let restaurant_id = rawRid;
        if ((req as any).userRole === "restaurant_user") {
          const ruRes = await query(
            `SELECT restaurant_id FROM restaurant_users WHERE user_id = $1 LIMIT 1`,
            [(req as any).user.id],
          );
          restaurant_id = ruRes.rows[0]?.restaurant_id ?? restaurant_id;
        }
        const conditions: string[] = ["acknowledged_at IS NULL"];
        const params: unknown[] = [];

        if (since) {
          params.push(new Date(since).toISOString());
          conditions.push(`sent_at > $${params.length}`);
        }
        if (restaurant_id) {
          params.push(restaurant_id);
          conditions.push(`(payload->'restaurant_ids' @> jsonb_build_array($${params.length}::text) OR payload->>'restaurant_id' = $${params.length}::text)`);
        }
        if (event_type) {
          params.push(event_type);
          conditions.push(`event_type = $${params.length}`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const result = await query(
          `SELECT COUNT(*) AS count FROM push_notification_log ${where}`,
          params,
        );
        const count = parseInt((result.rows[0] as { count: string }).count, 10);
        return res.json({ count });
      } catch (err: any) {
        clog.error("[GET /api/notifications/push-log/unread-count]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/notifications/push-log/top-offenders — top recurring out-of-stock / low-stock products (restaurant_user scoped)
  // Returns the products with the most alerts in the period, scoped by restaurant_id if given.
  app.get(
    "/api/notifications/push-log/top-offenders",
    requireAuth as any,
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const topOffendersParams = GetPushLogTopOffendersQueryParams.safeParse(req.query);
        if (!topOffendersParams.success) {
          return res.status(400).json({ detail: "Invalid query parameters", errors: topOffendersParams.error.errors });
        }
        const { start_date, end_date, restaurant_id: rawRid2, limit: lim, cover_days: coverDays } = topOffendersParams.data;
        let restaurant_id = rawRid2;
        if ((req as any).userRole === "restaurant_user") {
          const ruRes = await query(
            `SELECT restaurant_id FROM restaurant_users WHERE user_id = $1 LIMIT 1`,
            [(req as any).user.id],
          );
          restaurant_id = ruRes.rows[0]?.restaurant_id ?? restaurant_id;
        }

        const conditions: string[] = [`event_type IN ('low_stock', 'out_of_stock')`, `payload->>'product_id' IS NOT NULL`];
        const params: unknown[] = [];
        if (start_date) { params.push(start_date); conditions.push(`sent_at >= $${params.length}`); }
        if (end_date)   { params.push(end_date);   conditions.push(`sent_at <= $${params.length}`); }
        if (restaurant_id) {
          params.push(restaurant_id);
          conditions.push(`(payload->'restaurant_ids' @> jsonb_build_array($${params.length}::text) OR payload->>'restaurant_id' = $${params.length}::text)`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        params.push(lim);
        const result = await query(
          `SELECT
             payload->>'product_id'                   AS product_id,
             MAX(payload->>'name')                    AS name,
             MAX(payload->>'name_ar')                 AS name_ar,
             MAX(payload->>'sku')                     AS sku,
             MAX(payload->>'image_url')               AS image_url,
             COUNT(*) FILTER (WHERE event_type='out_of_stock') AS out_of_stock_count,
             COUNT(*) FILTER (WHERE event_type='low_stock')    AS low_stock_count,
             COUNT(*)                                          AS total_count,
             MAX(sent_at)                                       AS last_alert_at
           FROM push_notification_log
           ${where}
           GROUP BY payload->>'product_id'
           HAVING COUNT(*) >= 3
           ORDER BY total_count DESC, last_alert_at DESC
           LIMIT $${params.length}`,
          params,
        );

        const items = result.rows as any[];

        // Compute reorder suggestions: pull current stock + units sold in the
        // same window, then suggest qty = ceil(avg_daily_sales * cover_days) - current.
        const productIds = items.map((r) => r.product_id).filter(Boolean);
        const periodDays = (() => {
          if (start_date) {
            const start = new Date(String(start_date)).getTime();
            const end = end_date ? new Date(String(end_date)).getTime() : Date.now();
            if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
              return Math.max(1, Math.round((end - start) / 86_400_000));
            }
          }
          return 30;
        })();

        const stockMap = new Map<string, number>();
        const soldMap = new Map<string, number>();
        if (productIds.length > 0) {
          const stockRes = await query(
            `SELECT id::text AS id, COALESCE(stock_quantity, 0)::int AS stock
             FROM products WHERE id::text = ANY($1::text[])`,
            [productIds],
          );
          for (const r of stockRes.rows as { id: string; stock: number }[]) {
            stockMap.set(r.id, r.stock);
          }

          // Aggregate units sold from orders.items JSONB in the same window,
          // restricted to the restaurant scope when one is given.
          const salesParams: unknown[] = [productIds];
          let salesWhere = `o.deleted_at IS NULL AND o.status <> 'cancelled'
                            AND (ie->>'product_id') = ANY($1::text[])`;
          if (start_date) { salesParams.push(start_date); salesWhere += ` AND o.created_at >= $${salesParams.length}`; }
          if (end_date)   { salesParams.push(end_date);   salesWhere += ` AND o.created_at <= $${salesParams.length}`; }
          if (restaurant_id) {
            salesParams.push(restaurant_id);
            salesWhere += ` AND EXISTS (
              SELECT 1 FROM products p
              WHERE p.id::text = (ie->>'product_id')
                AND p.car_model_ids @> jsonb_build_array($${salesParams.length}::text)
            )`;
          }
          const salesRes = await query(
            `SELECT (ie->>'product_id') AS product_id,
                    COALESCE(SUM(NULLIF(ie->>'quantity','')::int), 0)::int AS sold
             FROM orders o
             CROSS JOIN jsonb_array_elements(o.items) ie
             WHERE ${salesWhere}
             GROUP BY (ie->>'product_id')`,
            salesParams,
          );
          for (const r of salesRes.rows as { product_id: string; sold: number }[]) {
            soldMap.set(r.product_id, r.sold);
          }
        }

        const enriched = items.map((r) => {
          const pid = String(r.product_id);
          const currentStock = stockMap.get(pid) ?? 0;
          const sold = soldMap.get(pid) ?? 0;
          const avgDaily = sold / periodDays;
          const target = Math.ceil(avgDaily * coverDays);
          // Suggest at least 1 unit if the product has been alerted repeatedly,
          // even when sales velocity is low (alerts already prove demand).
          const gap = Math.max(0, target - currentStock);
          const suggested = Math.max(1, gap);
          return {
            ...r,
            current_stock: currentStock,
            units_sold: sold,
            avg_daily_sales: Math.round(avgDaily * 100) / 100,
            cover_days: coverDays,
            suggested_reorder_qty: suggested,
          };
        });

        return res.json({ items: enriched, period_days: periodDays, cover_days: coverDays });
      } catch (err: any) {
        clog.error("[GET /api/notifications/push-log/top-offenders]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/notifications/push-log/daily-counts
  app.get(
    "/api/notifications/push-log/daily-counts",
    requireAuth as any,
    requireAdminRole(["owner", "partner", "admin", "restaurant_user"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { start_date, end_date, restaurant_id: rawRid3 } = req.query as Record<string, string | undefined>;
        let restaurant_id = rawRid3;
        if ((req as any).userRole === "restaurant_user") {
          const ruRes = await query(
            `SELECT restaurant_id FROM restaurant_users WHERE user_id = $1 LIMIT 1`,
            [(req as any).user.id],
          );
          restaurant_id = ruRes.rows[0]?.restaurant_id ?? restaurant_id;
        }

        const conditions: string[] = [`event_type IN ('low_stock', 'out_of_stock')`];
        const params: unknown[] = [];

        if (start_date) {
          params.push(start_date);
          conditions.push(`sent_at >= $${params.length}`);
        }
        if (end_date) {
          params.push(end_date);
          conditions.push(`sent_at <= $${params.length}`);
        }
        if (restaurant_id) {
          params.push(restaurant_id);
          conditions.push(`(payload->'restaurant_ids' @> jsonb_build_array($${params.length}::text) OR payload->>'restaurant_id' = $${params.length}::text)`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const result = await query(
          `SELECT DATE(sent_at AT TIME ZONE 'UTC') AS day, event_type, COUNT(*)::int AS count
           FROM push_notification_log
           ${where}
           GROUP BY DATE(sent_at AT TIME ZONE 'UTC'), event_type
           ORDER BY day ASC`,
          params,
        );

        // Build a sorted list of all days that appear in the result
        const daySet = new Set<string>();
        for (const row of result.rows as { day: string; event_type: string; count: number }[]) {
          daySet.add(String(row.day).slice(0, 10));
        }
        const days = Array.from(daySet).sort();

        // Fill in zeros for missing days / event_types
        const lowStock: number[] = [];
        const outOfStock: number[] = [];
        const rowMap = new Map<string, { low_stock: number; out_of_stock: number }>();
        for (const row of result.rows as { day: string; event_type: string; count: number }[]) {
          const d = String(row.day).slice(0, 10);
          if (!rowMap.has(d)) rowMap.set(d, { low_stock: 0, out_of_stock: 0 });
          const entry = rowMap.get(d)!;
          if (row.event_type === "low_stock") entry.low_stock = row.count;
          if (row.event_type === "out_of_stock") entry.out_of_stock = row.count;
        }
        for (const d of days) {
          const entry = rowMap.get(d) ?? { low_stock: 0, out_of_stock: 0 };
          lowStock.push(entry.low_stock);
          outOfStock.push(entry.out_of_stock);
        }

        return res.json({ days, series: { low_stock: lowStock, out_of_stock: outOfStock } });
      } catch (err: any) {
        clog.error("[GET /api/notifications/push-log/daily-counts]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // POST /api/notifications/push-log/acknowledge-all
  app.post(
    "/api/notifications/push-log/acknowledge-all",
    requireAuth as any,
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { start_date, end_date, event_type, restaurant_id: bodyRid } = req.body ?? {};
        let restaurant_id = bodyRid as string | undefined;
        if ((req as any).userRole === "restaurant_user") {
          const ruRes = await query(
            `SELECT restaurant_id FROM restaurant_users WHERE user_id = $1 LIMIT 1`,
            [(req as any).user.id],
          );
          restaurant_id = ruRes.rows[0]?.restaurant_id ?? restaurant_id;
        }
        const conditions: string[] = ["acknowledged_at IS NULL"];
        const params: unknown[] = [];

        if (start_date) {
          params.push(start_date);
          conditions.push(`sent_at >= $${params.length}`);
        }
        if (end_date) {
          params.push(end_date);
          conditions.push(`sent_at <= $${params.length}`);
        }
        if (event_type && event_type !== "all") {
          params.push(event_type);
          conditions.push(`event_type = $${params.length}`);
        }
        if (restaurant_id) {
          params.push(restaurant_id);
          conditions.push(`(payload->'restaurant_ids' @> jsonb_build_array($${params.length}::text) OR payload->>'restaurant_id' = $${params.length}::text)`);
        }

        const where = conditions.join(" AND ");
        const result = await query(
          `UPDATE push_notification_log
           SET acknowledged_at = NOW()
           WHERE ${where}
           RETURNING id`,
          params,
        );
        return res.json({ acknowledged_count: result.rows.length });
      } catch (err: any) {
        clog.error("[POST /api/notifications/push-log/acknowledge-all]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/notifications/push-log/:id/acknowledge — mark a log entry as acknowledged
  app.patch(
    "/api/notifications/push-log/:id/acknowledge",
    requireAuth as any,
    requireAdminRole(["owner"]) as any,
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;

        // restaurant_user may only acknowledge notifications scoped to their restaurant.
        if ((req as any).userRole === "restaurant_user") {
          const ruRes = await query(
            `SELECT restaurant_id FROM restaurant_users WHERE user_id = $1 LIMIT 1`,
            [(req as any).user.id],
          );
          const rid: string | undefined = ruRes.rows[0]?.restaurant_id;
          if (rid) {
            const check = await query(
              `SELECT id FROM push_notification_log
               WHERE id = $1
                 AND (payload->'restaurant_ids' @> jsonb_build_array($2::text) OR payload->>'restaurant_id' = $2)`,
              [id, rid],
            );
            if (check.rows.length === 0) {
              return res.status(403).json({ detail: "Forbidden" });
            }
          }
        }

        const result = await query(
          `UPDATE push_notification_log
           SET acknowledged_at = NOW()
           WHERE id = $1 AND acknowledged_at IS NULL
           RETURNING id, acknowledged_at`,
          [id],
        );
        if (result.rows.length === 0) {
          const exists = await query(
            `SELECT id, acknowledged_at FROM push_notification_log WHERE id = $1`,
            [id],
          );
          if (exists.rows.length === 0) {
            return res.status(404).json({ detail: "Notification not found" });
          }
          return res.json(exists.rows[0]);
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        clog.error("[PATCH /api/notifications/push-log/:id/acknowledge]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/notifications/my-push-log — customer-scoped push-log entries
  // Returns push_notification_log rows where the authenticated user is in
  // recipient_user_ids. Used by the mobile "missed push-log" recovery hook
  // to fire local OS notifications for order status changes that arrived
  // while the app was fully closed.
  app.get(
    "/api/notifications/my-push-log",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id as string | undefined;
        if (!userId) return res.status(401).json({ detail: "Not authenticated" });

        const { since, unread_only } = req.query as Record<string, string | undefined>;

        const conditions: string[] = [
          `recipient_user_ids @> jsonb_build_array($1::text)`,
        ];
        const params: unknown[] = [userId];

        if (since) {
          params.push(since);
          conditions.push(`sent_at > $${params.length}`);
        }
        if (unread_only === "true") {
          conditions.push(`acknowledged_at IS NULL`);
        }

        const where = `WHERE ${conditions.join(" AND ")}`;
        const result = await query(
          `SELECT id, event_type, title, body, payload, sent_at, acknowledged_at
           FROM push_notification_log
           ${where}
           ORDER BY sent_at ASC
           LIMIT 100`,
          params,
        );
        return res.json({ data: result.rows });
      } catch (err: any) {
        clog.error("[GET /api/notifications/my-push-log]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // PATCH /api/notifications/my-push-log/:id/acknowledge — customer-scoped ack
  // Marks a single push-log entry as acknowledged. Only succeeds if the
  // authenticated user is in the entry's recipient_user_ids array.
  app.patch(
    "/api/notifications/my-push-log/:id/acknowledge",
    requireAuth as any,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id as string | undefined;
        if (!userId) return res.status(401).json({ detail: "Not authenticated" });

        const { id } = req.params;

        const result = await query(
          `UPDATE push_notification_log
           SET acknowledged_at = NOW()
           WHERE id = $1
             AND recipient_user_ids @> jsonb_build_array($2::text)
             AND acknowledged_at IS NULL
           RETURNING id, acknowledged_at`,
          [id, userId],
        );

        if (result.rows.length === 0) {
          const exists = await query(
            `SELECT id, acknowledged_at FROM push_notification_log
             WHERE id = $1 AND recipient_user_ids @> jsonb_build_array($2::text)`,
            [id, userId],
          );
          if (exists.rows.length === 0) {
            return res.status(404).json({ detail: "Not found" });
          }
          return res.json(exists.rows[0]);
        }
        return res.json(result.rows[0]);
      } catch (err: any) {
        clog.error("[PATCH /api/notifications/my-push-log/:id/acknowledge]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/admin/housekeeping-stats — recent cleanup run history
  // Returns the last 100 rows from housekeeping_stats so admins can audit
  // how much data has been pruned over time.
  app.get(
    "/api/admin/housekeeping-stats",
    requireAdminRole(["owner", "admin"]) as any,
    async (_req: Request, res: Response) => {
      try {
        const result = await query(
          `SELECT id, run_at, table_name, rows_deleted
             FROM housekeeping_stats
            ORDER BY run_at DESC
            LIMIT 100`,
        );
        const parsed = GetHousekeepingStatsResponse.safeParse({ stats: result.rows });
        if (!parsed.success) {
          clog.warn("[GET /api/admin/housekeeping-stats] response shape mismatch", parsed.error.flatten());
        }
        return res.json({ stats: result.rows });
      } catch (err: any) {
        clog.error("[GET /api/admin/housekeeping-stats]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  // GET /api/admin/housekeeping-stats/by-table — cleanup totals grouped by table and date bucket
  // Returns SUM(rows_deleted) per table_name per daily/weekly bucket for the last N days.
  // Query params: bucket (day|week, default: day), days (integer 1–365, default: 30)
  app.get(
    "/api/admin/housekeeping-stats/by-table",
    requireAdminRole(["owner", "admin"]) as any,
    async (req: Request, res: Response) => {
      try {
        const paramsParsed = GetHousekeepingStatsByTableQueryParams.safeParse(req.query);
        if (!paramsParsed.success) {
          return res.status(400).json({
            detail: "Invalid query parameters",
            errors: paramsParsed.error.flatten().fieldErrors,
          });
        }
        const { bucket, days } = paramsParsed.data;

        const result = await query(
          `SELECT
              table_name,
              date_trunc($1, run_at)::date::text AS date_bucket,
              SUM(rows_deleted)::int              AS total_rows
             FROM housekeeping_stats
            WHERE run_at >= NOW() - ($2 || ' days')::interval
            GROUP BY table_name, date_trunc($1, run_at)::date
            ORDER BY date_bucket DESC, table_name`,
          [bucket, days],
        );
        return res.json({ groups: result.rows, bucket, days });
      } catch (err: any) {
        clog.error("[GET /api/admin/housekeeping-stats/by-table]", err.message);
        return res.status(500).json({ detail: err.message });
      }
    },
  );

  httpServer.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url || "", `http://localhost`);
    if (url.pathname === "/api/ws") {
      // Authenticate the WS connection by validating the session token server-side.
      // Clients (React Native) pass the token as ?token= since WebSocket doesn't support custom headers.
      // We also check the session_token cookie for web clients.
      let authenticatedUserId: string | undefined;
      try {
        // Token from query param (React Native mobile) or Authorization header or session cookie
        const queryToken = url.searchParams.get("token");
        const cookieHeader = req.headers.cookie || "";
        const cookies: Record<string, string> = {};
        cookieHeader.split(";").forEach((c) => {
          const [k, ...v] = c.trim().split("=");
          if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
        });
        const cookieToken = cookies["session_token"];
        const sessionToken = queryToken || cookieToken;
        if (sessionToken) {
          const sessionResult = await query(
            `SELECT s.user_id FROM sessions s
             WHERE s.session_token = $1 AND s.expires_at > NOW()
             LIMIT 1`,
            [sessionToken],
          );
          if (sessionResult.rows.length > 0) {
            authenticatedUserId = sessionResult.rows[0].user_id;
          }
        }
      } catch {}
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, authenticatedUserId);
      });
    } else {
      socket.destroy();
    }
  });

  return httpServer;
}

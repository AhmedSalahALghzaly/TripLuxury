/**
 * Restaurant Analytics API Routes
 * Provides per-restaurant orders, appointments, stats, and user-access management.
 * Access control:
 *   - owner / partner → all restaurants (full privileged access)
 *   - admin           → only their assigned restaurant(s) via restaurant_users
 *   - restaurant_user → only their assigned restaurant(s)
 */
import { Router, Request, Response, NextFunction } from "express";
import { query } from "../server-db";
import { requireAuth, getCurrentUser, getUserRole } from "../server-auth";

export function createRestaurantAnalyticsRouter(
  broadcastFn: (msg: object) => void,
  broadcastToUserFn: (userId: string, msg: object) => void,
): Router {
  const router = Router();

  // ── Ensure restaurant_users table exists (idempotent) ──────────────────────
  query(`
    CREATE TABLE IF NOT EXISTS restaurant_users (
      id UUID NOT NULL DEFAULT gen_random_uuid(),
      restaurant_id UUID NOT NULL,
      user_id UUID NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'viewer',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id),
      UNIQUE (restaurant_id, user_id)
    )
  `).catch(() => {});
  query(`CREATE INDEX IF NOT EXISTS idx_ru_restaurant ON restaurant_users (restaurant_id)`).catch(() => {});
  query(`CREATE INDEX IF NOT EXISTS idx_ru_user ON restaurant_users (user_id)`).catch(() => {});

  // ── Access helpers ──────────────────────────────────────────────────────────
  async function getAccess(userId: string, role: string): Promise<{ priv: boolean; ids: string[] }> {
    const priv = ["owner", "partner"].includes(role);
    if (priv) return { priv: true, ids: [] };
    const r = await query(`SELECT restaurant_id FROM restaurant_users WHERE user_id = $1`, [userId]);
    return { priv: false, ids: r.rows.map((row: any) => row.restaurant_id) };
  }

  async function checkAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = await getCurrentUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const role = await getUserRole(user.email as string);
    const { priv, ids } = await getAccess(user.id, role);
    const restaurantId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!priv && !ids.includes(restaurantId)) {
      res.status(403).json({ error: "No access to this restaurant" }); return;
    }
    (req as any)._analyticsUser = user;
    (req as any)._analyticsRole = role;
    (req as any)._analyticsPriv = priv;
    next();
  }

  // ── GET /api/restaurant-analytics/restaurants ──────────────────────────────
  router.get("/restaurants", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = await getUserRole(user.email);
      const { priv, ids } = await getAccess(user.id, role);

      if (!priv && ids.length === 0) {
        return res.status(403).json({ error: "No restaurant access" });
      }

      const params: any[] = [];
      let extra = "";
      if (!priv) {
        params.push(ids);
        extra = `AND cm.id = ANY($${params.length})`;
      }

      const result = await query(`
        SELECT
          cm.id, cm.name, cm.name_ar, cm.image_url, cm.images,
          cm.description, cm.description_ar, cm.created_at,
          cm.receipt_language,
          cb.name  AS brand_name,
          cb.name_ar AS brand_name_ar,
          cb.logo  AS brand_logo,
          COALESCE(ord.orders_count, 0)::int        AS orders_count,
          COALESCE(ord.total_revenue, 0)::float     AS total_revenue,
          COALESCE(ord.avg_order_value, 0)::float   AS avg_order_value,
          COALESCE(ru_c.cnt, 0)::int                AS assigned_users_count,
          (SELECT COUNT(*)::int FROM appointments)  AS appointments_count
        FROM car_models cm
        LEFT JOIN car_brands cb ON cm.brand_id = cb.id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(DISTINCT o.id)        AS orders_count,
            SUM(o.total_amount)         AS total_revenue,
            AVG(o.total_amount)         AS avg_order_value
          FROM orders o
          WHERE o.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(o.items) ie
              JOIN products p ON p.id::text = (ie->>'product_id')
              WHERE p.car_model_ids @> jsonb_build_array(cm.id::text)
                AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
            )
        ) ord ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS cnt
          FROM restaurant_users ru
          WHERE ru.restaurant_id = cm.id
        ) ru_c ON true
        WHERE cm.deleted_at IS NULL ${extra}
        ORDER BY cm.name
      `, params);

      return res.json({ restaurants: result.rows });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/restaurant-analytics/my-assignments ───────────────────────────
  // Returns restaurants explicitly assigned to the caller via restaurant_users.
  // MUST live before /:id routes — otherwise Express matches "my-assignments"
  // as an :id param and crashes on the UUID cast.
  router.get("/my-assignments", requireAuth as any, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const result = await query(
        `SELECT cm.id, cm.name, cm.name_ar, cm.image_url, cm.receipt_language
           FROM restaurant_users ru
           JOIN car_models cm ON cm.id = ru.restaurant_id
          WHERE ru.user_id = $1
          ORDER BY cm.name`,
        [user.id],
      );
      return res.json({ restaurants: result.rows });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/restaurant-analytics/:id/orders ───────────────────────────────
  router.get("/:id/orders", checkAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const page   = Math.max(1, parseInt(String(req.query.page  || "1")));
      const limit  = 50;
      const offset = (page - 1) * limit;
      const status = req.query.status as string | undefined;

      const params: any[] = [id, limit, offset];
      let statusClause = "";
      if (status && status !== "all") {
        params.push(status);
        statusClause = `AND o.status = $${params.length}`;
      }

      const existsSQL = `
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(o.items) ie
          JOIN products p ON p.id::text = (ie->>'product_id')
          WHERE p.car_model_ids @> jsonb_build_array($1::text)
            AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
        )`;

      // Use a CTE to compute stable per-restaurant sequential numbers
      // (over ALL orders for this restaurant, independent of pagination/filters)
      const rows = await query(`
        WITH all_rest_orders AS (
          SELECT o2.id,
            ROW_NUMBER() OVER (ORDER BY o2.created_at ASC, o2.id ASC)::int AS restaurant_order_number
          FROM orders o2
          WHERE o2.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(o2.items) ie2
              JOIN products p2 ON p2.id::text = (ie2->>'product_id')
              WHERE p2.car_model_ids @> jsonb_build_array($1::text)
                AND (p2.deleted_at IS NULL OR p2.deleted_at > NOW())
            )
        )
        SELECT
          o.id, o.order_number, aro.restaurant_order_number, o.status,
          o.total_amount::float AS total_amount,
          o.shipping_cost::float AS shipping_cost,
          o.customer_name, o.customer_email, o.customer_phone,
          o.user_name,   o.user_email,   o.user_phone,
          o.notes, o.payment_method,
          o.street_address, o.city, o.state,
          o.delivery_latitude, o.delivery_longitude, o.delivery_address,
          o.created_at, o.updated_at,
          u.name    AS joined_user_name,
          u.email   AS joined_user_email,
          u.phone   AS joined_user_phone,
          u.picture AS user_picture,
          jsonb_array_length(COALESCE(o.items,'[]'::jsonb)) AS items_count,
          (
            SELECT jsonb_agg(
              ie || jsonb_build_object(
                'nutrition',      COALESCE(p.nutrition,      'null'::jsonb),
                'ingredients',    COALESCE(p.ingredients,    '[]'::jsonb),
                'ingredients_ar', COALESCE(p.ingredients_ar, '[]'::jsonb),
                'description',    COALESCE(p.description,    ''),
                'description_ar', COALESCE(p.description_ar, '')
              )
            )
            FROM jsonb_array_elements(COALESCE(o.items,'[]'::jsonb)) ie
            LEFT JOIN products p ON p.id::text = (ie->>'product_id')
              AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
          ) AS items
        FROM orders o
        JOIN all_rest_orders aro ON aro.id = o.id
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.deleted_at IS NULL
          ${statusClause}
          AND ${existsSQL}
        ORDER BY o.created_at DESC
        LIMIT $2 OFFSET $3
      `, params);

      const countParams: any[] = [id];
      let countStatusClause = "";
      if (status && status !== "all") {
        countParams.push(status);
        countStatusClause = `AND o.status = $${countParams.length}`;
      }
      const countRow = await query(`
        SELECT COUNT(DISTINCT o.id)::int AS total
        FROM orders o
        WHERE o.deleted_at IS NULL ${countStatusClause} AND ${existsSQL}
      `, countParams);

      return res.json({
        orders: rows.rows,
        total:  countRow.rows[0]?.total ?? 0,
        page, limit,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/restaurant-analytics/:id/appointments ─────────────────────────
  router.get("/:id/appointments", checkAccess, async (req: Request, res: Response) => {
    try {
      const page   = Math.max(1, parseInt(String(req.query.page || "1")));
      const limit  = 50;
      const offset = (page - 1) * limit;
      const status = req.query.status as string | undefined;

      const { id } = req.params;
      const params: any[] = [id, limit, offset];
      let statusClause = "";
      if (status && status !== "all") {
        params.push(status);
        statusClause = `AND status = $${params.length}`;
      }

      const rows = await query(`
        SELECT
          id, user_id, user_name, user_email, user_phone,
          service_type, car_info, notes,
          appointment_date, duration_minutes, status,
          created_at, updated_at
        FROM appointments
        WHERE restaurant_id = $1
        ${statusClause}
        ORDER BY appointment_date DESC
        LIMIT $2 OFFSET $3
      `, params);

      const countParams: any[] = [id];
      let countStatusClause = "";
      if (status && status !== "all") {
        countParams.push(status);
        countStatusClause = `AND status = $${countParams.length}`;
      }
      const countRow = await query(
        `SELECT COUNT(*)::int AS total FROM appointments
         WHERE restaurant_id = $1 ${countStatusClause}`,
        countParams,
      );

      return res.json({
        appointments: rows.rows,
        total: countRow.rows[0]?.total ?? 0,
        page, limit,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/restaurant-analytics/:id/stats ────────────────────────────────
  router.get("/:id/stats", checkAccess, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const existsSQL = `
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(o.items) ie
          JOIN products p ON p.id::text = (ie->>'product_id')
          WHERE p.car_model_ids @> jsonb_build_array($1::text)
            AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
        )`;

      const [ordSt, apptSt, topProd] = await Promise.all([
        query(`
          SELECT
            COUNT(DISTINCT o.id)::int                                        AS total_orders,
            COALESCE(SUM(o.total_amount),0)::float                          AS total_revenue,
            COALESCE(AVG(o.total_amount),0)::float                          AS avg_order_value,
            COUNT(DISTINCT CASE WHEN o.status='pending'   THEN o.id END)::int AS pending,
            COUNT(DISTINCT CASE WHEN o.status='preparing' THEN o.id END)::int AS preparing,
            COUNT(DISTINCT CASE WHEN o.status='ready'     THEN o.id END)::int AS ready,
            COUNT(DISTINCT CASE WHEN o.status='shipped'   THEN o.id END)::int AS shipped,
            COUNT(DISTINCT CASE WHEN o.status='delivered' THEN o.id END)::int AS delivered,
            COUNT(DISTINCT CASE WHEN o.status='cancelled' THEN o.id END)::int AS cancelled,
            COUNT(DISTINCT o.user_id)::int                                  AS unique_customers
          FROM orders o
          WHERE o.deleted_at IS NULL AND ${existsSQL}
        `, [id]),
        query(`
          SELECT
            COUNT(*)::int                                                  AS total,
            COUNT(CASE WHEN status='pending'   THEN 1 END)::int          AS pending,
            COUNT(CASE WHEN status='confirmed' THEN 1 END)::int          AS confirmed,
            COUNT(CASE WHEN status='completed' THEN 1 END)::int          AS completed,
            COUNT(CASE WHEN status='cancelled' THEN 1 END)::int          AS cancelled,
            COUNT(CASE WHEN appointment_date >= NOW() THEN 1 END)::int   AS upcoming
          FROM appointments
          WHERE restaurant_id = $1
        `, [id]),
        query(`
          SELECT
            p.name, p.name_ar,
            p.price::float AS price,
            COUNT(*)::int AS order_count,
            COALESCE(SUM((ie->>'quantity')::int), 0)::int AS total_qty
          FROM orders o
          CROSS JOIN jsonb_array_elements(o.items) ie
          JOIN products p ON p.id::text = (ie->>'product_id')
          WHERE o.deleted_at IS NULL
            AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
            AND p.car_model_ids @> jsonb_build_array($1::text)
          GROUP BY p.id, p.name, p.name_ar, p.price
          ORDER BY order_count DESC
          LIMIT 10
        `, [id]),
      ]);

      return res.json({
        orders:       ordSt.rows[0]  || {},
        appointments: apptSt.rows[0] || {},
        top_products: topProd.rows,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/restaurant-analytics/:id/users (owner/partner only) ───────────
  router.get("/:id/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = await getUserRole(user.email);
      if (!["owner", "partner"].includes(role)) {
        return res.status(403).json({ error: "Owner/partner access required" });
      }
      const result = await query(`
        SELECT
          ru.id AS assignment_id, ru.role, ru.created_at AS assigned_at,
          u.id AS user_id, u.name AS user_name, u.email AS user_email,
          u.phone AS user_phone, u.picture AS user_picture
        FROM restaurant_users ru
        JOIN users u ON ru.user_id = u.id
        WHERE ru.restaurant_id = $1
        ORDER BY ru.created_at
      `, [req.params.id]);
      return res.json({ users: result.rows });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/restaurant-analytics/:id/users ──────────────────────────────
  router.post("/:id/users", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = await getUserRole(user.email);
      if (!["owner", "partner"].includes(role)) {
        return res.status(403).json({ error: "Owner/partner access required" });
      }

      const { email } = req.body;
      if (!email) return res.status(400).json({ error: "Email required" });

      const countRow = await query(
        `SELECT COUNT(*)::int AS cnt FROM restaurant_users WHERE restaurant_id = $1`,
        [req.params.id],
      );
      if ((countRow.rows[0]?.cnt ?? 0) >= 3) {
        return res.status(400).json({ error: "Maximum 3 users allowed per restaurant" });
      }

      const found = await query(
        `SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL LIMIT 1`,
        [email],
      );
      if (found.rows.length === 0) {
        return res.status(404).json({ error: "User not found with that email" });
      }
      const target = found.rows[0];

      const insertResult = await query(`
        INSERT INTO restaurant_users (id, restaurant_id, user_id, role)
        VALUES (gen_random_uuid(), $1, $2, 'viewer')
        ON CONFLICT (restaurant_id, user_id) DO NOTHING
        RETURNING id
      `, [req.params.id, target.id]);

      // Notify the assigned user in real-time so the mobile app can
      // invalidate its assignments query and transition automatically.
      if (insertResult.rows.length > 0) {
        broadcastToUserFn(target.id, {
          type: "restaurant_user_assigned",
          data: { restaurant_id: req.params.id, user_id: target.id },
        });
      }

      return res.json({ ok: true, user: { name: target.name, email: target.email } });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── PATCH /api/restaurant-analytics/:id/orders/:orderId/status ────────────
  // Scoped status update: verifies the actor is assigned to this restaurant
  // and the order actually belongs to it. Allows forward-only status flow.
  // Restaurant staff may advance: pending → preparing → ready → delivered.
  // NOTE: admin role is intentionally excluded — per the access model, admin is
  // read-only (no mutation). Only owner, partner, and assigned restaurant_users
  // may advance order status.
  router.patch("/:id/orders/:orderId/status", checkAccess, async (req: Request, res: Response) => {
    try {
      // Enforce read-only constraint for admin (documented at router top-level)
      const actorRole = (req as any)._analyticsRole as string;
      if (actorRole === "admin") {
        return res.status(403).json({ error: "Admin role is read-only and cannot modify order status" });
      }

      const { id: restaurantId, orderId } = req.params;
      const { status } = req.body as { status: string };

      const ALLOWED = ["pending", "preparing", "ready", "delivered"];
      if (!ALLOWED.includes(status)) {
        return res.status(400).json({ error: "Invalid status for restaurant staff" });
      }

      // Verify order belongs to this restaurant (order must contain a product linked to it)
      const existsSQL = `
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(o.items) ie
          JOIN products p ON p.id::text = (ie->>'product_id')
          WHERE p.car_model_ids @> jsonb_build_array($1::text)
            AND (p.deleted_at IS NULL OR p.deleted_at > NOW())
        )`;

      const checkRow = await query(
        `SELECT o.status FROM orders o WHERE o.id=$2 AND o.deleted_at IS NULL AND ${existsSQL}`,
        [restaurantId, orderId],
      );
      if (checkRow.rows.length === 0) {
        return res.status(403).json({ error: "Order not found or not part of this restaurant" });
      }

      const currentStatus = checkRow.rows[0].status;
      const currentIdx = ALLOWED.indexOf(currentStatus);
      const newIdx = ALLOWED.indexOf(status);

      // Terminal/legacy statuses (cancelled, shipped, etc.) are immutable for restaurant staff
      if (currentIdx === -1) {
        return res.status(400).json({ error: `Order is in terminal state '${currentStatus}' and cannot be modified` });
      }

      // Enforce forward-only progression
      if (newIdx <= currentIdx) {
        return res.status(400).json({ error: "Status can only move forward in the workflow" });
      }

      const result = await query(
        `UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`,
        [status, orderId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Order not found" });
      }

      broadcastFn({
        type: "order_status_changed",
        data: { order_id: orderId, new_status: status, previous_status: currentStatus, restaurant_id: restaurantId },
      });
      broadcastFn({ type: "order_updated", data: result.rows[0] });

      return res.json(result.rows[0]);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ── DELETE /api/restaurant-analytics/:id/users/:userId ────────────────────
  router.delete("/:id/users/:userId", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const role = await getUserRole(user.email);
      if (!["owner", "partner"].includes(role)) {
        return res.status(403).json({ error: "Owner/partner access required" });
      }
      await query(
        `DELETE FROM restaurant_users WHERE restaurant_id = $1 AND user_id = $2`,
        [req.params.id, req.params.userId],
      );
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}

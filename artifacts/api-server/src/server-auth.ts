import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query } from "./server-db";

export const AUTH_USER_COLUMNS =
  "id, email, name, picture, is_admin, phone, phone_verified, subscription_status, created_at, preferred_language, replit_user_id";

/**
 * Generates a safe column list for admin user-lookup responses.
 * Excludes password_hash, owner_temp_password, and raw replit_user_id.
 * Derived booleans (has_password, is_replit_user) replace sensitive raw values.
 *
 * @param alias - Optional table alias (e.g. "u"). When supplied every plain
 *                column is prefixed as `alias.column`; expression columns are
 *                wrapped accordingly.  Omit for direct single-table SELECTs.
 */
export function safeAdminUserColumns(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return [
    `${p}id`, `${p}email`, `${p}name`, `${p}picture`, `${p}is_admin`,
    `${p}phone`, `${p}phone_verified`, `${p}pending_phone`,
    `${p}subscription_status`, `${p}created_at`, `${p}preferred_language`,
    `(${p}password_hash IS NOT NULL) as has_password`,
    `(${p}replit_user_id IS NOT NULL) as is_replit_user`,
  ].join(', ');
}

/** Convenience constant for direct single-table queries (no alias needed). */
export const SAFE_ADMIN_USER_COLUMNS = safeAdminUserColumns();

export function generateSessionToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function serializeUser(user: any): Promise<any> {
  const serialized = {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    is_admin: user.is_admin,
    phone: user.phone || null,
    phone_verified: user.phone_verified || false,
    subscription_status: user.subscription_status || 'free',
    created_at: user.created_at,
    preferred_language: (user.preferred_language === 'en' ? 'en' : 'ar') as 'en' | 'ar',
  };
  return serialized;
}

export async function getUserRole(email: string): Promise<string> {
  if (!email) return "guest";
  const e = email.toLowerCase();

  // Owner role: explicit owners table membership OR is_admin flag on the user row.
  const owner = await query(
    "SELECT id FROM owners WHERE LOWER(email) = $1 AND deleted_at IS NULL",
    [e],
  );
  if (owner.rows.length > 0) return "owner";

  const adminUser = await query(
    "SELECT is_admin FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL",
    [e],
  );
  if (adminUser.rows.length > 0 && adminUser.rows[0].is_admin === true) return "owner";

  const partner = await query("SELECT id FROM partners WHERE LOWER(email) = $1 AND deleted_at IS NULL", [e]);
  if (partner.rows.length > 0) return "partner";

  const admin = await query("SELECT id FROM admins WHERE LOWER(email) = $1 AND deleted_at IS NULL", [e]);
  if (admin.rows.length > 0) return "admin";

  const subscriber = await query("SELECT id FROM subscribers WHERE LOWER(email) = $1 AND deleted_at IS NULL", [e]);
  if (subscriber.rows.length > 0) return "subscriber";

  const supplier = await query("SELECT id FROM suppliers WHERE LOWER(email) = $1 AND deleted_at IS NULL", [e]);
  if (supplier.rows.length > 0) return "supplier";

  const distributor = await query("SELECT id FROM distributors WHERE LOWER(email) = $1 AND deleted_at IS NULL", [e]);
  if (distributor.rows.length > 0) return "distributor";

  // Restaurant manager: user is in restaurant_users (assigned via the
  // user-management popup on /owner/restaurant-analytics). They get scoped
  // access to /owner/restaurant-analytics + /owner/notification-log for
  // their assigned restaurants only. Checked LAST so explicit roles win.
  const restaurantUser = await query(
    `SELECT rua.user_id
       FROM restaurant_users rua
       JOIN users u ON u.id = rua.user_id
      WHERE LOWER(u.email) = $1 AND u.deleted_at IS NULL
      LIMIT 1`,
    [e],
  );
  if (restaurantUser.rows.length > 0) return "restaurant_user";

  return "user";
}

/**
 * Returns the linked_restaurant_id for a partner account, or null if unset.
 * Used to scope partner reads/writes to their assigned restaurant only.
 */
export async function getPartnerRestaurantId(email: string): Promise<string | null> {
  if (!email) return null;
  const rows = await query(
    "SELECT linked_restaurant_id FROM partners WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1",
    [email.toLowerCase()],
  );
  return rows.rows[0]?.linked_restaurant_id ?? null;
}

/**
 * Checks whether a given user (customerId) has placed at least one order that
 * contains a product belonging to the specified restaurant.  Used to enforce
 * partner-scoped customer access.
 */
export async function customerBelongsToRestaurant(customerId: string, restaurantId: string): Promise<boolean> {
  if (!customerId || !restaurantId) return false;
  const rows = await query(
    `SELECT 1
       FROM orders o
       JOIN LATERAL (
         SELECT (item->>'product_id')::uuid AS pid
         FROM jsonb_array_elements(o.items) AS item
         WHERE item->>'product_id' IS NOT NULL
       ) oi ON TRUE
       JOIN products p ON p.id = oi.pid
      WHERE o.user_id = $1
        AND o.deleted_at IS NULL
        AND p.car_model_ids @> jsonb_build_array($2::text)
      LIMIT 1`,
    [customerId, restaurantId],
  );
  return rows.rows.length > 0;
}

/**
 * Returns the list of restaurant_ids (car_models.id) assigned to a restaurant_user.
 * Returns an empty array for any other role.
 */
export async function getUserRestaurantIds(userId: string): Promise<string[]> {
  if (!userId) return [];
  const rows = await query(
    "SELECT restaurant_id FROM restaurant_users WHERE user_id = $1",
    [userId],
  );
  return rows.rows.map((r: any) => r.restaurant_id as string);
}

export async function getPrivilegedUserIds(excludeUserId?: string): Promise<string[]> {
  const params: any[] = [];
  let extra = "";
  if (excludeUserId) {
    params.push(excludeUserId);
    extra = " AND u.id <> $1";
  }
  const rows = await query(
    `SELECT DISTINCT u.id FROM users u
     WHERE u.deleted_at IS NULL
       AND (
         LOWER(u.email) IN (SELECT LOWER(email) FROM owners   WHERE deleted_at IS NULL)
         OR LOWER(u.email) IN (SELECT LOWER(email) FROM admins   WHERE deleted_at IS NULL)
         OR LOWER(u.email) IN (SELECT LOWER(email) FROM partners WHERE deleted_at IS NULL)
       )${extra}`,
    params,
  );
  return rows.rows.map((r: any) => r.id);
}

export async function getCurrentUser(req: Request): Promise<any | null> {
  const token = req.cookies?.session_token || 
    req.headers?.authorization?.replace("Bearer ", "");
  
  if (!token) return null;
  
  try {
    const sessionResult = await query(
      "SELECT user_id FROM sessions WHERE session_token = $1 AND expires_at > NOW()",
      [token]
    );
    
    if (sessionResult.rows.length === 0) return null;
    const session = sessionResult.rows[0];
    
    const userResult = await query(
      "SELECT id, email, name, picture, is_admin, phone, phone_verified, subscription_status, created_at, preferred_language, replit_user_id FROM users WHERE id = $1 AND deleted_at IS NULL",
      [session.user_id]
    );
    
    if (userResult.rows.length === 0) return null;
    return userResult.rows[0];
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ detail: "Not authenticated" });
    return;
  }
  (req as any).user = user;
  // R1: bind authenticated user to the per-request Sentry isolation scope
  // *after* req.user is set (the pre-route sentry-context middleware runs
  // earlier and only has access to request_id at that point).
  try {
    const { bindSentryUser } = await import("./lib/sentry-context.js");
    bindSentryUser({ id: user.id, email: user.email });
  } catch {
    // Never block the request on monitoring wiring.
  }
  next();
}

export function requireAdminRole(allowedRoles = ["owner", "partner", "admin"]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ detail: "Not authenticated" });
      return;
    }
    const role = await getUserRole(user.email);
    if (!allowedRoles.includes(role)) {
      res.status(403).json({ detail: "Access denied" });
      return;
    }
    (req as any).user = user;
    (req as any).userRole = role;
    try {
      const { bindSentryUser } = await import("./lib/sentry-context.js");
      bindSentryUser({ id: user.id, email: user.email, role });
    } catch {
      // Never block the request on monitoring wiring.
    }
    next();
  };
}

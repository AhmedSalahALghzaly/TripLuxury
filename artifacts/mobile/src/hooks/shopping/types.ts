/**
 * Shared domain types for shopping hooks.
 * Replaces `any[]` in cart, order, and favorites throughout the hook layer
 * so TypeScript can catch shape mismatches between API responses and the UI.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface ProfileData {
  id?: string;
  name?: string;
  email?: string;
  phone?: string;
  phone_verified?: boolean;
  picture?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export interface CartItemVariant {
  /** e.g. "STD", "010", "020" */
  indicator: string;
  /** Variant-level price (may arrive as a string from the API). */
  price?: number | string | null;
  /** Available stock for this variant. */
  stock?: number | null;
  /** Product row id for this variant (used to construct new cart_item rows). */
  id?: string;
}

export interface CartItemProduct {
  id: string;
  name: string;
  name_ar?: string;
  price: number | string;
  image_url?: string | null;
  /** Additional image array returned by some endpoints. */
  images?: string[];
  sku?: string;
  stock_quantity?: number;
  fitment_indicator?: string | null;
  available_variants?: CartItemVariant[];
  car_model_ids?: string[];
  car_models?: unknown[];
  compatible_car_models?: unknown[];
  product_brand_name?: string | null;
  brand_name?: string | null;
}

export interface CartItem {
  /** Some API responses include a top-level `id` alias for `product_id`. */
  id?: string;
  product_id: string;
  quantity: number;
  fitment_indicator?: string | null;
  original_unit_price?: number | string;
  final_unit_price?: number | string;
  price?: number | string;
  name?: string;
  name_ar?: string;
  image_url?: string | null;
  /** Additional image array returned by some endpoints. */
  images?: string[];
  sku?: string;
  stock_quantity?: number;
  product_brand_name?: string | null;
  car_model_ids?: string[];
  car_models?: unknown[];
  compatible_car_models?: unknown[];
  bundle_group_id?: string | null;
  /** Percentage discount applied via a bundle offer (0–100). */
  bundle_discount_percentage?: number | string;
  product?: CartItemProduct;
  available_variants?: CartItemVariant[];
  __optimistic?: boolean;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface OrderItem {
  /** Top-level id alias — some API responses alias product_id as id. */
  id?: string;
  product_id: string;
  quantity: number;
  price?: number | string;
  name?: string;
  name_ar?: string;
  /** Fitment variant indicator, e.g. "STD", "010", "020". */
  fitment_indicator?: string | null;
  /** Product image snapshotted at checkout. */
  image_url?: string | null;
  /** Unit price for this item (authoritative display price). */
  unit_price?: number | string;
  /** Per-item discount amount applied at checkout. */
  discount?: number | string;
  /** Per-item special instructions or notes. */
  notes?: string;
}

export interface Order {
  id: string;
  status: string;
  /** Order reference number — may be a numeric sequence or a string code. */
  order_number?: number | string;
  items: RichOrderItem[];
  user_id?: string;
  /** Checkout first name (may differ from the user account name). */
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  created_at?: string;
  /** Gross order total. */
  total?: number | string;

  // ── Extended fields used by owner/admin order screens ───────────────────

  /** Total amount alias sometimes returned by the API alongside `total`. */
  total_amount?: number | string;
  /** Shipping cost line item. */
  shipping_cost?: number | string;
  /** Flat discount amount applied to the order. */
  discount_amount?: number | string;
  /** Discount amount alias (some endpoints use `discount`, others `discount_amount`). */
  discount?: number | string;
  /** Payment method identifier, e.g. "cash_on_delivery". */
  payment_method?: string;

  // ── Customer identity fields joined server-side ──────────────────────────
  /** Full name from the user account (joined by the server). */
  user_name?: string;
  /** Email from the user account (joined by the server). */
  user_email?: string;
  /** Display name stored at checkout or from the user profile. */
  customer_name?: string;
  /** Email stored at checkout. */
  customer_email?: string;
  /** Phone stored at checkout. */
  customer_phone?: string;

  // ── Delivery address fields ──────────────────────────────────────────────
  street_address?: string;
  city?: string;
  state?: string;
  country?: string;
  /** Free-form delivery address string (alternative to structured fields). */
  delivery_address?: string;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  delivery_instructions?: string;

  // ── Additional order metadata ────────────────────────────────────────────
  /** Internal notes / flags persisted on the order (e.g. delivery_discount flags). */
  notes?: string;
  /** Coupon code applied at checkout. */
  coupon_code?: string;
  /** Subscription-based discount amount. */
  subscription_discount?: number | string;

  // ── Read-receipt tracking ────────────────────────────────────────────────
  /** The order status at the time the customer last viewed the order. */
  customer_last_read_status?: string;
  /** ISO timestamp when the customer last viewed the order. */
  customer_read_at?: string;
}

// ---------------------------------------------------------------------------
// Rich order item — extends OrderItem with all display fields that
// OrderItemCard and order-detail views access beyond the base shape.
// ---------------------------------------------------------------------------

export interface RestaurantRef {
  id?: string;
  name: string;
  name_ar?: string;
}

export interface RichOrderItem extends OrderItem {
  product_name?: string;
  sku?: string;
  product_brand_name?: string | null;
  brand_name?: string | null;
  product_image?: string | null;
  /** Unit price at time of order (authoritative display price). */
  unit_price?: number | string;
  /** Original unit price before any bundle or coupon discount. */
  original_unit_price?: number | string;
  /** Percentage discount applied via a bundle offer (0–100). */
  bundle_discount_percentage?: number | string;
  /** Bundle group identifier — links all items belonging to the same bundle. */
  bundle_group_id?: string | null;
  /** ID of the bundle offer that generated this item (used for navigation). */
  bundle_offer_id?: string | null;
  compatible_car_models?: RestaurantRef[];
  car_models?: RestaurantRef[];
  product?: {
    product_brand_name?: string | null;
    brand_name?: string | null;
    compatible_car_models?: RestaurantRef[];
    car_models?: RestaurantRef[];
  };
}

// ---------------------------------------------------------------------------
// Minimal theme colours passed as a prop between shopping-hub components.
// Matches the subset of the useTheme() `colors` object that these
// components actually reference so callers stay structurally compatible.
// ---------------------------------------------------------------------------

export interface ThemeColors {
  text: string;
  textSecondary: string;
  surface: string;
  border: string;
  card: string;
  background: string;
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

/** Minimal restaurant/category ref used inside Favorite items. */
export interface FavoriteRef {
  id?: string;
  name?: string;
  name_ar?: string;
}

export interface FavoriteProduct {
  id: string;
  name: string;
  name_ar?: string;
  price: number | string;
  image_url?: string | null;
  /** Additional image array returned by some endpoints. */
  images?: string[];
  sku?: string;
  stock_quantity?: number;
  car_model_ids?: string[];
  fitment_indicator?: string | null;
  product_brand_name?: string | null;
  /** Discounted / original price before markdown. */
  original_price?: number | string;
  originalPrice?: number | string;
  /** Localised category labels. */
  category_name_ar?: string;
  category_name_en?: string;
  compatible_car_models?: FavoriteRef[];
}

export interface Favorite {
  /** Top-level id alias (some endpoints alias product_id as id). */
  id?: string;
  product_id: string;
  product: FavoriteProduct;
  name?: string;
  name_ar?: string;
  price?: number | string;
  image_url?: string | null;
  /** Additional image array returned by some endpoints. */
  images?: string[];
  sku?: string;
  stock_quantity?: number;
  fitment_indicator?: string | null;
  product_brand_name?: string | null;
  /** Localised category labels that may be joined server-side at the favorite level. */
  category_name_ar?: string;
  category_name_en?: string;
  compatible_car_models?: FavoriteRef[];
  car_model_ids?: string[];
}

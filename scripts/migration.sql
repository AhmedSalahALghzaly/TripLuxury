-- Al-Ghazaly Dining — Complete Database Migration Script
-- Generated: 2026-05-02T19:49:22.413Z
-- Run this on a fresh PostgreSQL database to create all tables

CREATE SEQUENCE IF NOT EXISTS notification_events_id_seq;

BEGIN;

CREATE TABLE IF NOT EXISTS admins (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  phone VARCHAR(50),
  picture TEXT,
  role VARCHAR(100) DEFAULT 'admin'::character varying,
  permissions JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS ai_training_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  knowledge_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'::character varying,
  result JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (key)
);

CREATE TABLE IF NOT EXISTS appointment_history (
  id VARCHAR(36) NOT NULL,
  appointment_id VARCHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor_id VARCHAR(36),
  actor_name VARCHAR(255),
  actor_email VARCHAR(255),
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  user_phone VARCHAR(50),
  service_type VARCHAR(100) NOT NULL DEFAULT 'maintenance'::character varying,
  car_info VARCHAR(255),
  notes TEXT,
  appointment_date TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status VARCHAR(50) NOT NULL DEFAULT 'pending'::character varying,
  calendar_event_id VARCHAR(255),
  restaurant_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_appt_restaurant ON appointments (restaurant_id);

CREATE TABLE IF NOT EXISTS bundle_offers (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(500),
  name_ar VARCHAR(500),
  description TEXT,
  description_ar TEXT,
  image_url TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  discount_percentage NUMERIC DEFAULT 0,
  total_price NUMERIC,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  product_ids JSONB DEFAULT '[]'::jsonb,
  products JSONB DEFAULT '[]'::jsonb,
  car_model_id UUID,
  car_model_year_start INTEGER,
  car_model_year_end INTEGER,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS bundles (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(500),
  name_ar VARCHAR(500),
  description TEXT,
  description_ar TEXT,
  image_url TEXT,
  discount_percentage NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  product_ids JSONB DEFAULT '[]'::jsonb,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS car_brands (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  logo_url TEXT,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  logo TEXT,
  distributor_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS car_models (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  car_brand_id UUID,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  year INTEGER,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  year_start INTEGER,
  year_end INTEGER,
  image_url TEXT,
  images JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  description_ar TEXT,
  variants JSONB DEFAULT '[]'::jsonb,
  chassis_number VARCHAR(255),
  catalog_pdf TEXT,
  fuel_type VARCHAR(100),
  brand_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  tables_count INTEGER DEFAULT 0,
  video_url TEXT,
  receipt_language TEXT DEFAULT 'auto',
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  fitment_indicator VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  bundle_group_id UUID,
  bundle_offer_id UUID,
  bundle_discount_percentage NUMERIC,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  description TEXT,
  description_ar TEXT,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  icon TEXT,
  image_data TEXT,
  parent_id UUID,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID NOT NULL,
  product_id UUID NOT NULL,
  user_id UUID NOT NULL,
  text TEXT NOT NULL,
  rating NUMERIC,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS conversation_group_members (
  group_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, conversation_id)
);

CREATE TABLE IF NOT EXISTS conversation_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#7C3AED'::character varying,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  agent_id UUID,
  type VARCHAR(20) NOT NULL DEFAULT 'direct_chat'::character varying,
  status VARCHAR(20) NOT NULL DEFAULT 'active'::character varying,
  ai_auto_reply BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS distributors (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  website TEXT,
  country VARCHAR(255),
  notes TEXT,
  logo TEXT,
  region VARCHAR(255),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS favorites (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  product_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS home_slider (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  title_ar VARCHAR(500),
  subtitle TEXT,
  subtitle_ar TEXT,
  image_url TEXT,
  link_url TEXT,
  button_text VARCHAR(255),
  button_text_ar VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL,
  title VARCHAR(500),
  content TEXT,
  file_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS marketing_items (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  title_ar VARCHAR(500),
  description TEXT,
  description_ar TEXT,
  image_url TEXT,
  link_url TEXT,
  type VARCHAR(50) DEFAULT 'banner'::character varying,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  item_type VARCHAR(100),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL DEFAULT 'customer'::character varying,
  content TEXT,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text'::character varying,
  file_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  ai_auto_reply_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  latitude NUMERIC,
  longitude NUMERIC,
  address TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS notification_events (
  id BIGINT NOT NULL DEFAULT nextval('notification_events_id_seq'::regclass),
  notification_id UUID NOT NULL,
  user_id UUID NOT NULL,
  event TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID,
  title TEXT,
  title_ar TEXT,
  message TEXT,
  message_ar TEXT,
  type VARCHAR(50) DEFAULT 'info'::character varying,
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
-- rating_id FK added below after order_ratings is created (see Task 50 block)

CREATE TABLE IF NOT EXISTS offers (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  title_ar VARCHAR(500),
  description TEXT,
  description_ar TEXT,
  discount_percent NUMERIC,
  discount_amount NUMERIC,
  image_url TEXT,
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  product_ids JSONB DEFAULT '[]'::jsonb,
  category_ids JSONB DEFAULT '[]'::jsonb,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  discount_percentage NUMERIC,
  offer_type VARCHAR(100),
  min_order_amount NUMERIC,
  code VARCHAR(100),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID,
  order_number VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'pending'::character varying,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  shipping_address JSONB,
  payment_method VARCHAR(50),
  notes TEXT,
  customer_last_read_status VARCHAR(50),
  customer_read_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  shipping_cost NUMERIC DEFAULT 0,
  customer_name VARCHAR(255),
  customer_phone VARCHAR(50),
  customer_email VARCHAR(255),
  admin_notes TEXT,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  user_phone VARCHAR(50),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  street_address TEXT,
  city VARCHAR(255),
  state VARCHAR(255),
  country VARCHAR(255),
  delivery_instructions TEXT,
  admin_viewed BOOLEAN NOT NULL DEFAULT false,
  delivery_latitude NUMERIC,
  delivery_longitude NUMERIC,
  delivery_address TEXT,
  PRIMARY KEY (id)
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude  NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude NUMERIC;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address   TEXT;

CREATE TABLE IF NOT EXISTS owners (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  phone VARCHAR(50),
  picture TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS partners (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  website TEXT,
  logo TEXT,
  notes TEXT,
  partner_type VARCHAR(100),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS password_requests (
  id TEXT NOT NULL,
  user_id UUID NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending'::text,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS price_hide_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID,
  product_id UUID,
  status VARCHAR(50) DEFAULT 'pending'::character varying,
  notes TEXT,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS product_brands (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),
  description TEXT,
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  logo TEXT,
  country_of_origin VARCHAR(255),
  country_of_origin_ar VARCHAR(255),
  supplier_id UUID,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  name_ar VARCHAR(500),
  description TEXT,
  description_ar TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  category_id UUID,
  product_brand_id UUID,
  sku VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  is_featured BOOLEAN DEFAULT false,
  fitment_indicator VARCHAR(100),
  fitment_stock_variants JSONB,
  car_model_ids JSONB DEFAULT '[]'::jsonb,
  allergens JSONB DEFAULT '[]'::jsonb,
  calories INTEGER,
  ingredients JSONB,
  ingredients_ar JSONB,
  pairing_notes TEXT,
  pairing_notes_ar TEXT,
  nutrition JSONB,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  hidden_status BOOLEAN DEFAULT false,
  images JSONB DEFAULT '[]'::jsonb,
  added_by_admin_id UUID,
  is_tire BOOLEAN DEFAULT false,
  product_type VARCHAR(100),
  fitment_price_variants JSONB,
  base_fitment_sku VARCHAR(255),
  sort_order INTEGER DEFAULT 0,
  search_vector TSVECTOR,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS promotions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  title_ar VARCHAR(500),
  image TEXT,
  promotion_type VARCHAR(100) DEFAULT 'banner'::character varying,
  is_active BOOLEAN DEFAULT true,
  target_product_id UUID,
  target_car_model_id UUID,
  sort_order INTEGER DEFAULT 0,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  phone VARCHAR(50),
  subscription_type VARCHAR(100),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS subscription_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name VARCHAR(255),
  user_email VARCHAR(255),
  user_phone VARCHAR(50),
  business_name VARCHAR(500),
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending'::character varying,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  customer_name TEXT,
  email TEXT,
  phone TEXT,
  governorate TEXT DEFAULT ''::text,
  village TEXT DEFAULT ''::text,
  detailed_address TEXT DEFAULT ''::text,
  car_model_name TEXT DEFAULT ''::text,
  business_type TEXT DEFAULT ''::text,
  request_type TEXT DEFAULT 'subscription'::text,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  website TEXT,
  country VARCHAR(255),
  notes TEXT,
  logo TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  plan_type VARCHAR(50) NOT NULL DEFAULT 'basic'::character varying,
  status VARCHAR(50) NOT NULL DEFAULT 'active'::character varying,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  start_date TIMESTAMP WITH TIME ZONE,
  end_date TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  auto_renew BOOLEAN DEFAULT false,
  price NUMERIC,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  password_hash TEXT,
  picture TEXT,
  is_admin BOOLEAN DEFAULT false,
  phone VARCHAR(50),
  phone_verified BOOLEAN DEFAULT false,
  subscription_status VARCHAR(50) DEFAULT 'free'::character varying,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  google_id TEXT,
  email_verified BOOLEAN DEFAULT false,
  email_verification_code TEXT,
  email_code_expires_at TIMESTAMP WITH TIME ZONE,
  pending_phone TEXT,
  replit_user_id TEXT,
  owner_temp_password TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS restaurant_users (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id),
  UNIQUE (restaurant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ru_restaurant ON restaurant_users (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_ru_user ON restaurant_users (user_id);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS admins_email_key ON admins (email);
CREATE INDEX IF NOT EXISTS idx_appointment_history_appt ON appointment_history (appointment_id);
CREATE INDEX IF NOT EXISTS idx_cart_items_user_created ON cart_items (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_product_id ON comments (product_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments (user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations (status);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS distributors_email_key ON distributors (email);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_id_product_id_key ON favorites (user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_type ON knowledge_base (type);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_notification_id ON notification_events (notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_events_occurred_at ON notification_events (occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS notification_events_notification_id_user_id_event_key ON notification_events (notification_id, user_id, event);
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS owners_email_key ON owners (email);
CREATE UNIQUE INDEX IF NOT EXISTS partners_email_key ON partners (email);
CREATE INDEX IF NOT EXISTS idx_password_requests_status ON password_requests (status);
CREATE INDEX IF NOT EXISTS idx_password_requests_user_id ON password_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products (name);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_token_key ON sessions (session_token);
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_email_key ON subscribers (email);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_email_key ON suppliers (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- Task 4: Suppliers & Distributors domain realignment
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS linked_restaurant_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS linked_category_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS linked_category_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS venue_types JSONB DEFAULT '[]'::jsonb;

-- Task 5: Post-delivery order ratings
CREATE TABLE IF NOT EXISTS order_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  user_id UUID NOT NULL,
  restaurant_id UUID,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  user_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_order_ratings_restaurant ON order_ratings (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_ratings_created ON order_ratings (created_at DESC);
-- Multi-restaurant ratings: drop legacy single-row unique constraint and replace with
-- two partial unique indexes so one rating row per restaurant per order is stored.
ALTER TABLE order_ratings DROP CONSTRAINT IF EXISTS order_ratings_order_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS order_ratings_with_restaurant_uq
  ON order_ratings (order_id, user_id, restaurant_id)
  WHERE restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS order_ratings_null_restaurant_uq
  ON order_ratings (order_id, user_id)
  WHERE restaurant_id IS NULL;

-- FK constraints for order_ratings (idempotent via DO blocks)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_ratings_order_id_fkey'
  ) THEN
    ALTER TABLE order_ratings
      ADD CONSTRAINT order_ratings_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_ratings_user_id_fkey'
  ) THEN
    ALTER TABLE order_ratings
      ADD CONSTRAINT order_ratings_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_ratings_restaurant_id_fkey'
  ) THEN
    ALTER TABLE order_ratings
      ADD CONSTRAINT order_ratings_restaurant_id_fkey
      FOREIGN KEY (restaurant_id) REFERENCES car_models(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'car_models' AND column_name = 'receipt_language'
  ) THEN
    ALTER TABLE car_models ADD COLUMN receipt_language TEXT DEFAULT 'auto';
  END IF;
END $$;

-- Task 50: Admin replies to customer ratings
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS admin_reply TEXT;
ALTER TABLE order_ratings ADD COLUMN IF NOT EXISTS admin_reply_at TIMESTAMP WITH TIME ZONE;

-- Add rating_id FK on notifications now that order_ratings exists (idempotent)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS rating_id UUID REFERENCES order_ratings(id) ON DELETE SET NULL;

-- Task 51: Push notification device token registry
CREATE TABLE IF NOT EXISTS expo_push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'expo',
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS expo_push_tokens_user_id_idx ON expo_push_tokens(user_id);

-- Migrate from old table name if it exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_tokens' AND table_schema = 'public') THEN
    INSERT INTO expo_push_tokens (id, user_id, token, platform, created_at, updated_at)
      SELECT id, user_id, token, platform, created_at, updated_at FROM push_tokens
      ON CONFLICT (user_id, token) DO NOTHING;
    DROP TABLE push_tokens;
  END IF;
END $$;

COMMIT;

-- Task 16: Customer preferred language for push notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'ar';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'users' AND constraint_name = 'users_preferred_language_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_preferred_language_check CHECK (preferred_language IN ('en', 'ar'));
  END IF;
END $$;

-- Task 14: Push notification history log
CREATE TABLE IF NOT EXISTS push_notification_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type          TEXT NOT NULL DEFAULT 'new_order',
  title               TEXT,
  body                TEXT,
  payload             JSONB NOT NULL DEFAULT '{}',
  recipient_user_ids  JSONB NOT NULL DEFAULT '[]',
  recipient_count     INT NOT NULL DEFAULT 0,
  sent_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS push_notification_log_sent_at_idx ON push_notification_log(sent_at DESC);
-- Idempotent: add recipient_user_ids column if table was created without it
ALTER TABLE push_notification_log ADD COLUMN IF NOT EXISTS recipient_user_ids JSONB NOT NULL DEFAULT '[]';
-- Task 20: Acknowledge notifications
ALTER TABLE push_notification_log ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS push_notification_log_ack_idx ON push_notification_log(acknowledged_at) WHERE acknowledged_at IS NULL;
-- Task 18: GIN index for fast per-user push-log lookups (recipient_user_ids @> jsonb_build_array(user_id))
CREATE INDEX IF NOT EXISTS push_notification_log_recipient_ids_gin_idx ON push_notification_log USING GIN (recipient_user_ids);
-- Task 19: Cleanup policy — rows older than 30 days (acknowledged or not) are
-- expired by a server-side setInterval job in index.ts (expireOldPushLogs).
-- The job runs once on startup then every 24 hours.  No DB-level cron is needed
-- because the API server is always running; if a longer-lived policy is ever
-- preferred, add: `pg_cron: SELECT cron.schedule('daily-push-log-cleanup',
-- '0 3 * * *', $$DELETE FROM push_notification_log WHERE sent_at < NOW() -
-- INTERVAL ''30 days''$$);`

-- Task 57: Stock change history
CREATE TABLE IF NOT EXISTS stock_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_quantity    INT NOT NULL,
  new_quantity    INT NOT NULL,
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT,
  source          TEXT NOT NULL DEFAULT 'manual',
  changed_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS stock_history_product_id_idx ON stock_history(product_id, changed_at DESC);

-- Task 60: Backfill image_url into push_notification_log payload for older
-- low_stock / out_of_stock alerts that were saved before image_url was included.
-- Idempotent: only touches rows where image_url is absent and a matching product exists.
-- Includes soft-deleted products so historical alert cards still show their thumbnail.
-- Uses case-insensitive UUID regex (~*) to handle any mixed-case stored values.
DO $$
BEGIN
  UPDATE push_notification_log pnl
     SET payload = pnl.payload || jsonb_build_object(
           'image_url',
           COALESCE(
             p.image_url,
             (
               SELECT s2.image_url
                 FROM products s2
                WHERE s2.sku = p.sku
                  AND s2.image_url IS NOT NULL
                  AND s2.deleted_at IS NULL
                LIMIT 1
             )
           )
         )
    FROM products p
   WHERE pnl.event_type IN ('low_stock', 'out_of_stock')
     AND pnl.payload->>'image_url' IS NULL
     AND pnl.payload->>'product_id' IS NOT NULL
     AND (pnl.payload->>'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND p.id = (pnl.payload->>'product_id')::uuid;
END $$;
-- ─── User Saved Addresses ────────────────────────────────────────────────────
-- Each customer can save up to 3 addresses (home / work / club). The
-- /checkout screen picks one, then the chosen address autofills the
-- shipping fields and writes lat/lng/address into the resulting orders
-- row. The label set is intentionally fixed so the UI shows three slots
-- exactly (and so duplicate-label inserts are blocked at the DB layer).
CREATE TABLE IF NOT EXISTS user_addresses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT NOT NULL CHECK (label IN ('home', 'work', 'club')),
  address         TEXT,
  governorate     TEXT,
  city            TEXT,
  latitude        NUMERIC,
  longitude       NUMERIC,
  phone           TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, label)
);

CREATE INDEX IF NOT EXISTS user_addresses_user_id_idx
  ON user_addresses (user_id);


-- car_models: latitude/longitude for restaurant location map in car/[id]
ALTER TABLE car_models ADD COLUMN IF NOT EXISTS latitude  NUMERIC;
ALTER TABLE car_models ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- restaurant_hours: per-day opening schedule (0=Sunday … 6=Saturday)
CREATE TABLE IF NOT EXISTS restaurant_hours (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID        NOT NULL REFERENCES car_models(id) ON DELETE CASCADE,
  day_of_week   SMALLINT    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_minutes  INTEGER,
  close_minutes INTEGER,
  is_closed     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_restaurant_hours_restaurant_id ON restaurant_hours (restaurant_id);

-- Task 25: Bilingual title/body columns for push_notification_log
-- Storing both language variants lets the owner notification history UI
-- display each entry in the viewer's preferred language instead of always
-- showing only the language that happened to be chosen at insert time.
ALTER TABLE push_notification_log ADD COLUMN IF NOT EXISTS title_en TEXT;
ALTER TABLE push_notification_log ADD COLUMN IF NOT EXISTS title_ar TEXT;
ALTER TABLE push_notification_log ADD COLUMN IF NOT EXISTS body_en   TEXT;
ALTER TABLE push_notification_log ADD COLUMN IF NOT EXISTS body_ar   TEXT;

-- Task 29: Housekeeping stats — persist a running tally of pruned rows
-- so the team can audit cleanup history without relying on transient logs.
CREATE TABLE IF NOT EXISTS housekeeping_stats (
  id         BIGSERIAL   PRIMARY KEY,
  run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  table_name TEXT        NOT NULL,
  rows_deleted INTEGER   NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_housekeeping_stats_table_run
  ON housekeeping_stats (table_name, run_at DESC);

-- Task 67: Email verification codes with database-enforced expiry
-- expires_at is NOT NULL, so every row carries a hard deadline set at insert
-- time by the application (NOW() + 10 minutes). All SELECT queries must
-- include WHERE expires_at > NOW() so expired codes are never usable.
-- The periodic cleanup job continues to DELETE expired rows for storage hygiene.
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id         BIGSERIAL   PRIMARY KEY,
  email      TEXT        NOT NULL,
  code       TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index on (email, expires_at).
-- Every lookup is WHERE email = $1 AND code = $2 AND expires_at > NOW().
-- The index lets Postgres find the matching email rows first, then apply the
-- expires_at range filter entirely within the index without touching the heap.
-- This is the standard PostgreSQL pattern for time-bounded lookups: a pure
-- partial index predicate would require an IMMUTABLE expression, but NOW() is
-- STABLE, so a composite index on the bounding column is the correct approach.
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email_expires
  ON email_verification_codes (email, expires_at);

-- Task #121: Partner restaurant scoping — link each partner to their restaurant
ALTER TABLE partners ADD COLUMN IF NOT EXISTS linked_restaurant_id UUID REFERENCES car_models(id) ON DELETE SET NULL;

-- Task #93: Bundle offer ratings
CREATE TABLE IF NOT EXISTS bundle_offer_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  bundle_offer_id UUID NOT NULL REFERENCES bundle_offers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (bundle_offer_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bundle_offer_ratings_bundle
  ON bundle_offer_ratings (bundle_offer_id, created_at DESC);

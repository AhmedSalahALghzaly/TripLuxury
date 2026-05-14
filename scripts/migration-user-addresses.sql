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

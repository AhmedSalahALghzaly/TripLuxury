/**
 * Backfill `appointments.restaurant_id` for legacy bookings.
 *
 * Strategy:
 *   1. Match `car_info` against `car_models.name` / `name_ar`.
 *   2. Fallback: first restaurant (oldest by created_at) so no booking is left
 *      orphaned. This lets restaurant-scoped analytics drop their global
 *      fallback safely.
 *
 * After backfill, enforces NOT NULL on `appointments.restaurant_id`.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/backfill-appointment-restaurants.ts
 */
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function q(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function run() {
  console.log('\n📌 Backfilling appointments.restaurant_id ...\n');

  await q(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS restaurant_id UUID`);
  await q(`CREATE INDEX IF NOT EXISTS idx_appt_restaurant ON appointments (restaurant_id)`);

  const before = await q(
    `SELECT COUNT(*)::int AS n FROM appointments WHERE restaurant_id IS NULL`,
  );
  console.log(`   Untagged bookings before: ${before.rows[0].n}`);

  // 1) Match by car_info → car_models.name / name_ar
  const matched = await q(`
    UPDATE appointments a
       SET restaurant_id = cm.id
      FROM car_models cm
     WHERE a.restaurant_id IS NULL
       AND a.car_info IS NOT NULL
       AND a.car_info <> ''
       AND (cm.name = a.car_info OR cm.name_ar = a.car_info)
  `);
  console.log(`   Matched via car_info → car_models: ${matched.rowCount}`);

  // 2) Default any remaining nulls to the oldest restaurant
  const defaultRest = await q(
    `SELECT id, COALESCE(name_ar, name) AS label
       FROM car_models
      ORDER BY created_at ASC NULLS LAST, id ASC
      LIMIT 1`,
  );
  if (defaultRest.rows.length === 0) {
    console.warn('   ⚠️  No restaurants found in car_models — cannot backfill defaults.');
  } else {
    const { id, label } = defaultRest.rows[0];
    const filled = await q(
      `UPDATE appointments SET restaurant_id = $1 WHERE restaurant_id IS NULL`,
      [id],
    );
    console.log(`   Defaulted ${filled.rowCount} bookings → "${label}" (${id})`);
  }

  const after = await q(
    `SELECT COUNT(*)::int AS n FROM appointments WHERE restaurant_id IS NULL`,
  );
  console.log(`   Untagged bookings after: ${after.rows[0].n}`);

  if (after.rows[0].n === 0) {
    console.log('   Enforcing NOT NULL on appointments.restaurant_id ...');
    await q(`ALTER TABLE appointments ALTER COLUMN restaurant_id SET NOT NULL`);
    console.log('   ✓ NOT NULL constraint applied.');
  } else {
    console.warn('   ⚠️  Skipping NOT NULL — some bookings still untagged.');
  }

  await pool.end();
  console.log('\n✅ Backfill complete.\n');
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});

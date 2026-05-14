/**
 * Backfill `image_url` into push_notification_log.payload for older
 * low_stock / out_of_stock alerts that were inserted before the image_url
 * field was added to the payload.
 *
 * Strategy:
 *   For every row where event_type IN ('low_stock','out_of_stock'),
 *   payload->>'image_url' IS NULL, and payload->>'product_id' is a valid UUID
 *   that exists in the products table (including soft-deleted rows — the image
 *   URL itself is still valid even if the product is no longer active), patch
 *   the payload JSONB with the product's image_url (or the first non-null
 *   image_url from a live sibling row with the same SKU).
 *
 * Idempotent: rows that already have image_url are untouched, and the query
 * can be re-run safely any number of times.
 *
 * UUID check uses case-insensitive regex (~*) to handle any mixed-case UUID
 * values that may have been stored historically.
 *
 * Run: pnpm --filter @workspace/scripts run backfill:notification-images
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
  console.log('\n🖼  Backfilling image_url into push_notification_log payloads ...\n');

  const before = await q(`
    SELECT COUNT(*)::int AS n
      FROM push_notification_log
     WHERE event_type IN ('low_stock', 'out_of_stock')
       AND payload->>'image_url' IS NULL
       AND payload->>'product_id' IS NOT NULL
       AND (payload->>'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  `);
  console.log(`   Alerts missing image_url: ${before.rows[0].n}`);

  if (before.rows[0].n === 0) {
    console.log('   Nothing to backfill — all alerts already have image_url.\n');
    await pool.end();
    console.log('✅ Done.\n');
    return;
  }

  // Patch payload using the same COALESCE logic as the server's low-stock
  // alert handler: prefer the product's own image_url, fall back to any
  // sibling row with the same SKU that does have an image.
  const result = await q(`
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
       AND p.id = (pnl.payload->>'product_id')::uuid
  `);
  console.log(`   Patched: ${result.rowCount} alert rows`);

  // Report any alerts whose product is not found at all (fully purged from DB)
  const orphaned = await q(`
    SELECT COUNT(*)::int AS n
      FROM push_notification_log
     WHERE event_type IN ('low_stock', 'out_of_stock')
       AND payload->>'image_url' IS NULL
       AND payload->>'product_id' IS NOT NULL
       AND (payload->>'product_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  `);
  if (orphaned.rows[0].n > 0) {
    console.warn(
      `   ⚠️  ${orphaned.rows[0].n} alert(s) still missing image_url — product may be deleted or image was never set.`,
    );
  }

  await pool.end();
  console.log('\n✅ Backfill complete.\n');
}

run().catch((err) => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});

import { Pool, types } from "pg";

// Fix: PostgreSQL returns NUMERIC/DECIMAL types as strings by default.
// Override the parser to return floats instead.
// OID 1700 = NUMERIC, OID 700 = FLOAT4, OID 701 = FLOAT8
types.setTypeParser(1700, (val: string) => parseFloat(val));
types.setTypeParser(700, (val: string) => parseFloat(val));
types.setTypeParser(701, (val: string) => parseFloat(val));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default pool;

export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Run a callback inside a transaction with automatic BEGIN/COMMIT/ROLLBACK.
 * The callback receives a `q` function with the same signature as `query` but
 * bound to the transaction's client.
 */
export async function withTransaction<T>(
  fn: (q: (text: string, params?: any[]) => Promise<any>) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const q = (text: string, params?: any[]) => client.query(text, params);
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

// One shared connection pool for the whole app (website AND Android app talk to the same database).
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node-pg returns BIGINT and NUMERIC as strings by default. Prices are whole so'm and averages are small,
// so plain JavaScript numbers are safe and much easier to work with.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL || 'postgres://shushop:shushop@localhost:5432/shushop';
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);

// Hosted databases need an encrypted connection; a local one does not. Certificate checking stays ON.
// Supabase signs with its own certificate authority, which is bundled in certs/supabase-ca.crt.
// Another provider: put its CA certificate text in DB_SSL_CA or a file path in DB_SSL_CA_FILE.
function sslConfig() {
  if (isLocal) return false;
  if (process.env.DB_SSL_CA) return { ca: process.env.DB_SSL_CA };
  if (process.env.DB_SSL_CA_FILE) return { ca: readFileSync(process.env.DB_SSL_CA_FILE, 'utf8') };
  if (/supabase\.(com|co)/.test(url)) return { ca: readFileSync(path.join(here, '..', 'certs', 'supabase-ca.crt'), 'utf8') };
  return true;
}

export const pool = new pg.Pool({ connectionString: url, ssl: sslConfig(), max: 10 });

// Run one query. ALWAYS pass user input in `params` ($1, $2...) - never glue it into the SQL text.
export const query = (text, params) => pool.query(text, params);

// Run several queries as ONE transaction: all succeed (COMMIT) or none do (ROLLBACK).
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

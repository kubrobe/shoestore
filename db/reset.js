// Drops all Shushop tables and creates them again with the demo data.
//   npm run db:reset
// Only the tables of this app are dropped (never the whole schema), so it is also safe on Supabase.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TABLES = ['notifications', 'order_status_log', 'order_items', 'orders', 'coupons', 'stock_alerts', 'cart_items',
  'favourites', 'reviews', 'variants', 'products', 'brands', 'addresses', 'sessions', 'users'];

export async function resetDatabase({ withSeed = true } = {}) {
  await pool.query('DROP VIEW IF EXISTS product_ratings');
  for (const t of TABLES) await pool.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  await pool.query(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  if (withSeed) await pool.query(fs.readFileSync(path.join(here, 'seed.sql'), 'utf8'));
}

// Run directly (npm run db:reset), not when imported by the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  await resetDatabase();
  const r = await pool.query('SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM variants) AS variants, (SELECT count(*) FROM users) AS users');
  console.log(`Database ready: ${r.rows[0].products} shoes, ${r.rows[0].variants} size/colour variants, ${r.rows[0].users} users.`);
  console.log('Demo login: alex@demo.uz / demo12345   Admin: admin@shushop.uz / admin12345');
  await pool.end();
}

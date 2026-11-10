import './setup.js';                       // must stay the first import
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../server.js';
import { pool } from '../src/db.js';
import { resetDatabase } from '../db/reset.js';

export { pool };

// Starts the real Express app on a free port with a freshly reset database. Returns small helpers.
export async function startApp() {
  await resetDatabase();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { body, token, cookie, headers: extra } = {}) {
    const headers = { ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* svg / html answers are not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers, cookies: res.headers.getSetCookie?.() ?? [] };
  }

  async function login(email, password = 'demo12345') {
    const r = await call('POST', '/api/mobile/login', { body: { email, password } });
    assert.equal(r.status, 200, `login ${email} failed: ${r.text}`);
    return r.body.token;
  }

  async function stop() {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  return { base, call, login, stop };
}

// A shoe by its exact name, with its sizes and colours.
export async function shoe(t, name) {
  const list = await t.call('GET', `/api/products?search=${encodeURIComponent(name)}`);
  const found = list.body.products.find((p) => p.name === name);
  assert.ok(found, `shoe "${name}" not found`);
  return (await t.call('GET', `/api/products/${found.id}`)).body.product;
}

// First size/colour of a shoe that has at least `min` pairs, optionally in a given size.
export function pick(detail, { size, min = 3 } = {}) {
  const v = detail.variants.find((x) => x.stock >= min && (size === undefined || x.size === size));
  assert.ok(v, `no variant with ${min}+ pairs for ${detail.name}`);
  return v;
}

export const setStock = (variantId, stock) => pool.query('UPDATE variants SET stock = $2 WHERE id = $1', [variantId, stock]);
export const stockOf = async (variantId) => (await pool.query('SELECT stock FROM variants WHERE id = $1', [variantId])).rows[0].stock;
export const count = async (table, where = 'true', params = []) =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0].n;

export const ADDRESS = { line: 'Test street 12, apt 5', city: 'Tashkent', phone: '+998 90 111 22 33' };

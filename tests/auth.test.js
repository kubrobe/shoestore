import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, pool } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(() => t.stop());

const newUser = (n) => ({ email: `new${n}@test.uz`, password: 'secret123', full_name: 'New Person', phone: '+998 90 000 11 22' });

test('register creates an account, sets an httpOnly cookie and never returns the password', async () => {
  const r = await t.call('POST', '/api/register', { body: newUser(1) });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.email, 'new1@test.uz');
  assert.equal(r.body.user.role, 'customer');
  assert.equal(JSON.stringify(r.body).includes('password'), false);
  const cookie = r.cookies.find((c) => c.startsWith('shushop_session='));
  assert.ok(cookie, 'session cookie is set');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  const stored = await pool.query(`SELECT password_hash FROM users WHERE email = 'new1@test.uz'`);
  assert.match(stored.rows[0].password_hash, /^\$2[aby]\$/, 'password is stored as a bcrypt hash');
});

test('the website cookie identifies the user on later requests', async () => {
  const r = await t.call('POST', '/api/login', { body: { email: 'alex@demo.uz', password: 'demo12345' } });
  assert.equal(r.status, 200);
  const cookie = r.cookies[0].split(';')[0];
  const me = await t.call('GET', '/api/me', { cookie });
  assert.equal(me.body.user.email, 'alex@demo.uz');
  assert.equal(me.body.user.shoeSizeEu, 42);
  const anon = await t.call('GET', '/api/me');
  assert.equal(anon.body.user, null);
});

test('registering the same email twice is refused (case-insensitive)', async () => {
  const r = await t.call('POST', '/api/register', { body: { ...newUser(2), email: 'ALEX@demo.uz' } });
  assert.equal(r.status, 409);
});

test('bad registration input is rejected before the database is touched', async () => {
  assert.equal((await t.call('POST', '/api/register', { body: { ...newUser(3), password: 'short' } })).status, 400);
  assert.equal((await t.call('POST', '/api/register', { body: { ...newUser(3), email: 'not-an-email' } })).status, 400);
  assert.equal((await t.call('POST', '/api/register', { body: { ...newUser(3), full_name: 'A' } })).status, 400);
  assert.equal((await t.call('POST', '/api/register', { body: { ...newUser(3), phone: 'abc' } })).status, 400);
  assert.equal((await t.call('POST', '/api/register', { body: { ...newUser(3), password: 'x'.repeat(73) } })).status, 400);
});

test('wrong password and unknown email give the same answer', async () => {
  const wrong = await t.call('POST', '/api/login', { body: { email: 'alex@demo.uz', password: 'nope-nope-1' } });
  const unknown = await t.call('POST', '/api/login', { body: { email: 'nobody@demo.uz', password: 'nope-nope-1' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, unknown.body.error);
});

test('app login returns a Bearer token that works, and logout kills it', async () => {
  const token = await t.login('aziza@demo.uz');
  assert.equal(token.length, 64);
  assert.equal((await t.call('GET', '/api/me', { token })).body.user.email, 'aziza@demo.uz');
  assert.equal((await t.call('POST', '/api/mobile/logout', { token })).status, 200);
  assert.equal((await t.call('GET', '/api/me', { token })).body.user, null);
  // only the hash of a token is stored
  const rows = await pool.query('SELECT token_hash FROM sessions');
  assert.ok(rows.rows.every((r) => r.token_hash !== token && r.token_hash.length === 64));
});

test('the app can register too and is logged in straight away', async () => {
  const r = await t.call('POST', '/api/mobile/register', { body: newUser(4) });
  assert.equal(r.status, 201);
  assert.equal((await t.call('GET', '/api/summary', { token: r.body.token })).status, 200);
});

test('too many wrong passwords are slowed down (429)', async () => {
  let last;
  for (let i = 0; i < 9; i++) last = await t.call('POST', '/api/login', { body: { email: 'bobur@demo.uz', password: `wrong-pass-${i}` } });
  assert.equal(last.status, 429);
  // ...and even the right password is refused while the limit is active
  assert.equal((await t.call('POST', '/api/login', { body: { email: 'bobur@demo.uz', password: 'demo12345' } })).status, 429);
});

test('private routes need a login, admin routes need the admin role', async () => {
  assert.equal((await t.call('GET', '/api/cart')).status, 401);
  assert.equal((await t.call('GET', '/api/orders')).status, 401);
  assert.equal((await t.call('GET', '/api/admin/stats')).status, 401);
  const customer = await t.login('alex@demo.uz');
  assert.equal((await t.call('GET', '/api/admin/stats', { token: customer })).status, 403);
  const admin = await t.login('admin@shushop.uz', 'admin12345');
  assert.equal((await t.call('GET', '/api/admin/stats', { token: admin })).status, 200);
});

test('profile can be edited; shoe size is validated', async () => {
  const token = await t.login('aziza@demo.uz');
  const ok = await t.call('PATCH', '/api/me', { token, body: { fullName: 'Aziza K.', shoeSizeEu: 39 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.shoeSizeEu, 39);
  assert.equal((await t.call('PATCH', '/api/me', { token, body: { shoeSizeEu: 99 } })).status, 400);
  assert.equal((await t.call('PATCH', '/api/me', { token, body: { fullName: 'x' } })).status, 400);
});

test('changing the password checks the old one and logs out other devices', async () => {
  const a = await t.call('POST', '/api/mobile/register', { body: newUser(5) });          // "phone 1"
  const b = await t.call('POST', '/api/mobile/login', { body: { email: 'new5@test.uz', password: 'secret123' } });   // "phone 2"
  assert.equal((await t.call('POST', '/api/me/password', { token: a.body.token, body: { currentPassword: 'wrong-one', newPassword: 'another-pass-1' } })).status, 400);
  assert.equal((await t.call('POST', '/api/me/password', { token: a.body.token, body: { currentPassword: 'secret123', newPassword: 'short' } })).status, 400);
  assert.equal((await t.call('POST', '/api/me/password', { token: a.body.token, body: { currentPassword: 'secret123', newPassword: 'another-pass-1' } })).status, 200);
  assert.equal((await t.call('GET', '/api/me', { token: a.body.token })).body.user.email, 'new5@test.uz', 'this device stays logged in');
  assert.equal((await t.call('GET', '/api/me', { token: b.body.token })).body.user, null, 'the other device is logged out');
  assert.equal((await t.call('POST', '/api/mobile/login', { body: { email: 'new5@test.uz', password: 'another-pass-1' } })).status, 200);
});

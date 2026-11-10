// Registration, login, logout and the "who is logged in?" middleware.
// The website and the Android app share ONE users table and ONE sessions table.
// Only the way the token travels differs: the website keeps it in an httpOnly cookie,
// the app sends "Authorization: Bearer <token>" (phones have no cookie jar).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from './db.js';
import { HttpError, cleanEmail, cleanPassword, cleanText, cleanPhone } from './validate.js';

const COOKIE = 'shushop_session';
const SESSION_DAYS = 30;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Create a random token and store only its HASH in the database. The raw token is given out once.
export async function createSessionToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), userId, expires]);
  return { token, expires };
}

export const deleteSession = (token) => query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);

// After a password change: every other browser / phone has to log in again, this one stays logged in.
export const revokeOtherSessions = (userId, keepToken) =>
  query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, sha256(keepToken || '')]);

async function startCookieSession(res, userId) {
  const { token, expires } = await createSessionToken(userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,            // JavaScript in the page cannot read it (protects against XSS theft)
    sameSite: 'lax',           // not sent on cross-site POSTs (protects against CSRF)
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
}

// Token from the Authorization header (app) or the cookie (website).
export function sessionToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return req.cookies?.[COOKIE] || null;
}

// Middleware: attaches req.user when the request carries a valid session token.
export async function loadUser(req, _res, next) {
  try {
    const token = sessionToken(req);
    if (token) {
      const r = await query(
        `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.shoe_size_eu, u.created_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
      req.user = r.rows[0] || null;
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in first'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in first'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Admins only'));
  next();
}

export const publicUser = (u) => ({
  id: u.id, email: u.email, fullName: u.full_name, phone: u.phone || '', role: u.role,
  shoeSizeEu: u.shoe_size_eu ?? null, memberSince: u.created_at,
});

// Very small login rate limiter: 8 failed attempts per email+IP per 10 minutes. (In memory: fine for one server.)
const failures = new Map();
function checkLimit(key) {
  const now = Date.now();
  const list = (failures.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  failures.set(key, list);
  if (list.length >= 8) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
const recordFailure = (key) => failures.set(key, [...(failures.get(key) || []), Date.now()]);

async function doRegister(body) {
  const email = cleanEmail(body.email);
  const password = cleanPassword(body.password);
  const name = cleanText(body.full_name ?? body.fullName, { min: 2, max: 60, field: 'Name' });
  const phone = cleanPhone(body.phone);
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await query(
      `INSERT INTO users (email, password_hash, full_name, phone) VALUES ($1,$2,$3,$4)
       RETURNING id, email, full_name, phone, role, shoe_size_eu, created_at`, [email, hash, name, phone]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That email is already registered');
    throw e;
  }
}

async function doLogin(req) {
  const email = cleanEmail(req.body.email);
  const key = `${req.ip}|${email}`;
  checkLimit(key);
  const r = await query(
    'SELECT id, email, full_name, phone, role, shoe_size_eu, created_at, password_hash FROM users WHERE email = $1', [email]);
  const ok = r.rows[0] && (await bcrypt.compare(String(req.body.password || ''), r.rows[0].password_hash));
  // Same message for "no such email" and "wrong password" so attackers learn nothing.
  if (!ok) { recordFailure(key); throw new HttpError(401, 'Wrong email or password'); }
  failures.delete(key);
  return r.rows[0];
}

export function authRoutes(app) {
  // ----- website (cookie) -----
  app.post('/api/register', async (req, res) => {
    const user = await doRegister(req.body);
    await startCookieSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  });

  app.post('/api/login', async (req, res) => {
    const user = await doLogin(req);
    await startCookieSession(res, user.id);
    res.json({ user: publicUser(user) });
  });

  app.post('/api/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await deleteSession(token);
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  app.get('/api/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  // ----- Android app (Bearer token in the answer) -----
  app.post('/api/mobile/register', async (req, res) => {
    const user = await doRegister(req.body);
    const { token } = await createSessionToken(user.id);
    res.status(201).json({ token, user: publicUser(user) });
  });

  app.post('/api/mobile/login', async (req, res) => {
    const user = await doLogin(req);
    const { token } = await createSessionToken(user.id);
    res.json({ token, user: publicUser(user) });
  });

  app.post('/api/mobile/logout', async (req, res) => {
    const token = sessionToken(req);
    if (token) await deleteSession(token);
    res.json({ ok: true });
  });
}

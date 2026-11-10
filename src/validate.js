// Input validation. Every API route checks its input here BEFORE touching the database.
// The database has its own CHECK constraints too (defence in depth).

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function cleanText(value, { min = 0, max, field }) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (s.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}

export function cleanEmail(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(s) || s.length > 254) throw new HttpError(400, 'Please enter a valid email address');
  return s;
}

export function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (value.length > 72) throw new HttpError(400, 'Password must be at most 72 characters'); // bcrypt limit
  return value;
}

export function cleanId(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${field} must be a positive whole number`);
  return n;
}

export function cleanInt(value, { min, max, field }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}`);
  return n;
}

export function cleanChoice(value, allowed, field) {
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function cleanHex(value, field) {
  if (typeof value !== 'string' || !HEX_RE.test(value)) throw new HttpError(400, `${field} must be a colour like #1b1b1d`);
  return value.toLowerCase();
}

// Phone: optional; digits, spaces, + - ( ) allowed, 7-20 characters
export function cleanPhone(value, { required = false } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s && !required) return null;
  if (!/^[+\d][\d\s\-()]{6,19}$/.test(s)) throw new HttpError(400, 'Please enter a valid phone number');
  return s;
}

// Text used in LIKE searches: escape the characters that mean something in a pattern.
export const likeEscape = (s) => String(s || '').trim().slice(0, 60).replace(/[\\%_]/g, '\\$&');

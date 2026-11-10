// Shushop web server (Express + PostgreSQL). Serves the website AND the JSON API that the Android app uses.
import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser, authRoutes } from './src/auth.js';
import { catalogRoutes } from './src/catalog.js';
import { shopRoutes } from './src/shop.js';
import { adminRoutes } from './src/admin.js';
import { mobileRoutes } from './src/mobile.js';
import { HttpError } from './src/validate.js';

const app = express();
app.set('trust proxy', 1);   // behind Render's proxy, so secure cookies and the client IP work
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Basic browser security headers. Pages only load their own scripts and styles; pictures may come from https
// (shop owners can paste a photo link) and from data: URLs.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(loadUser);                        // sets req.user when logged in

// Express 4 does not catch errors thrown inside async routes by itself; this wrapper does.
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) =>
    typeof route === 'string' && handlers.length
      ? original(route, ...handlers.map((h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)))
      : original(route, ...handlers);
}

authRoutes(app);
catalogRoutes(app);
shopRoutes(app);
adminRoutes(app);
mobileRoutes(app);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
// Unknown page: a friendly 404 page instead of a blank error
app.use((req, res, next) => (req.method === 'GET' && req.accepts('html')
  ? res.status(404).sendFile(path.join(__dirname, 'public', '404.html'))
  : next()));

// One place that turns errors into JSON answers
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err.code === '23514') return res.status(400).json({ error: 'That value is not allowed' });   // CHECK constraint
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Shushop running on http://localhost:${PORT}`));
}
export default app;

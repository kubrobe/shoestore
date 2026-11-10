// The shop owner's API. Every route needs a logged-in user whose role is "admin".
// Changes made here are visible to customers immediately because the website and the app read the same tables.
import { query, withTransaction } from './db.js';
import { requireAdmin } from './auth.js';
import { HttpError, cleanId, cleanInt, cleanText, cleanChoice, cleanHex } from './validate.js';
import { cardColumns, CARD_FROM, productCard, variantJson, orderJson } from './shape.js';
import { STYLES } from './shoe-art.js';
import { ORDER_STATUSES, formatSom } from './rules.js';
import { notifyInterested, notifyMany } from './notify.js';
import { setOrderStatus } from './orders.js';

const CATEGORIES = ['men', 'women', 'kids', 'unisex'];
const TZ = `'Asia/Tashkent'`;   // the shop's day starts at midnight in Tashkent, not in UTC

function cleanImageUrl(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (s.length > 500) throw new HttpError(400, 'Image link is too long');
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'Image link must be a full https:// address'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'Image link must start with https://');
  return u.toString();
}

function readVariant(v) {
  return {
    size: cleanInt(v?.size, { min: 16, max: 50, field: 'Size' }),
    colorName: cleanText(v?.colorName, { min: 1, max: 30, field: 'Colour name' }),
    colorHex: cleanHex(v?.colorHex, 'Colour'),
    stock: cleanInt(v?.stock ?? 0, { min: 0, max: 1000, field: 'Stock' }),
  };
}

function readProduct(b) {
  const price = cleanInt(b.price, { min: 1000, max: 100_000_000, field: 'Price' });
  const oldPrice = b.oldPrice === undefined || b.oldPrice === null || b.oldPrice === '' ? null
    : cleanInt(b.oldPrice, { min: 1000, max: 100_000_000, field: 'Old price' });
  if (oldPrice !== null && oldPrice <= price) throw new HttpError(400, 'The old price must be higher than the current price');
  return {
    name: cleanText(b.name, { min: 2, max: 80, field: 'Name' }),
    brand: cleanText(b.brand, { min: 2, max: 40, field: 'Brand' }),
    type: cleanText(b.type || 'Sneakers', { min: 2, max: 30, field: 'Type' }),
    category: cleanChoice(b.category, CATEGORIES, 'Category'),
    description: cleanText(b.description ?? '', { max: 1000, field: 'Description' }),
    price,
    oldPrice,
    artStyle: cleanChoice(b.artStyle || 'court', STYLES, 'Picture style'),
    imageUrl: cleanImageUrl(b.imageUrl),
    isActive: b.isActive === undefined ? true : b.isActive === true,
  };
}

async function brandId(db, name) {
  const found = await db.query('SELECT id FROM brands WHERE lower(name) = lower($1)', [name]);
  if (found.rows[0]) return found.rows[0].id;
  return (await db.query('INSERT INTO brands (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
}

const adminCard = (r) => ({ ...productCard(r), totalStock: Number(r.total_stock) });

async function loadAdminProduct(id) {
  const p = await query(`SELECT ${cardColumns('0')} ${CARD_FROM} WHERE p.id = $1`, [id]);
  if (!p.rows[0]) throw new HttpError(404, 'Shoe not found');
  const v = await query('SELECT id, product_id, size, color_name, color_hex, stock FROM variants WHERE product_id = $1 ORDER BY color_name, size', [id]);
  return { ...adminCard(p.rows[0]), variants: v.rows.map(variantJson) };
}

export function adminRoutes(app) {
  // ---------------------------------------------------------------- dashboard
  app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
    const [totals, byStatus, low, top, days] = await Promise.all([
      query(`SELECT
          (SELECT count(*) FROM orders) AS orders_total,
          (SELECT count(*) FROM orders WHERE (created_at AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date) AS orders_today,
          (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status <> 'cancelled') AS revenue,
          (SELECT COALESCE(SUM(total), 0) FROM orders WHERE status <> 'cancelled' AND created_at >= now() - interval '7 days') AS revenue_7d,
          (SELECT count(*) FROM users WHERE role = 'customer') AS customers,
          (SELECT count(*) FROM products WHERE is_active) AS products,
          (SELECT count(*) FROM variants v JOIN products p ON p.id = v.product_id WHERE p.is_active AND v.stock = 0) AS sold_out`),
      query('SELECT status, count(*)::int AS n FROM orders GROUP BY status'),
      query(`SELECT v.id, p.id AS product_id, p.name, v.size, v.color_name, v.stock
               FROM variants v JOIN products p ON p.id = v.product_id
              WHERE p.is_active AND v.stock BETWEEN 1 AND 2 ORDER BY v.stock, p.name, v.size LIMIT 10`),
      query(`SELECT oi.product_name AS name, SUM(oi.qty)::int AS units, SUM(oi.qty * oi.unit_price) AS revenue
               FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status <> 'cancelled'
              GROUP BY oi.product_name ORDER BY units DESC, revenue DESC LIMIT 5`),
      query(`SELECT d::date AS day, COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS revenue,
                    count(o.id) FILTER (WHERE o.status <> 'cancelled')::int AS orders
               FROM generate_series((now() AT TIME ZONE ${TZ})::date - 6, (now() AT TIME ZONE ${TZ})::date, interval '1 day') d
               LEFT JOIN orders o ON (o.created_at AT TIME ZONE ${TZ})::date = d::date
              GROUP BY d ORDER BY d`),
    ]);
    const t = totals.rows[0];
    const statusCounts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
    for (const s of byStatus.rows) statusCounts[s.status] = s.n;
    res.json({
      ordersTotal: t.orders_total, ordersToday: t.orders_today, revenue: t.revenue, revenue7d: t.revenue_7d,
      customers: t.customers, products: t.products, soldOutVariants: t.sold_out,
      ordersByStatus: statusCounts,
      lowStock: low.rows.map((r) => ({ variantId: r.id, productId: r.product_id, name: r.name, size: r.size, colorName: r.color_name, stock: r.stock })),
      topProducts: top.rows,
      last7Days: days.rows.map((d) => ({ day: d.day, revenue: d.revenue, orders: d.orders })),
    });
  });

  // ---------------------------------------------------------------- products
  app.get('/api/admin/products', requireAdmin, async (_req, res) => {
    const r = await query(`SELECT ${cardColumns('0')} ${CARD_FROM} ORDER BY p.is_active DESC, p.id DESC`);
    res.json({ products: r.rows.map(adminCard) });
  });

  app.get('/api/admin/products/:id', requireAdmin, async (req, res) => {
    res.json({ product: await loadAdminProduct(cleanId(req.params.id, 'id')) });
  });

  app.post('/api/admin/products', requireAdmin, async (req, res) => {
    const p = readProduct(req.body);
    const variantsIn = Array.isArray(req.body.variants) ? req.body.variants : [];
    if (variantsIn.length > 300) throw new HttpError(400, 'At most 300 size/colour combinations per shoe');
    const variants = variantsIn.map(readVariant);
    const id = await withTransaction(async (c) => {
      const bid = await brandId(c, p.brand);
      const r = await c.query(
        `INSERT INTO products (brand_id, name, type, category, description, price, old_price, art_style, image_url, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [bid, p.name, p.type, p.category, p.description, p.price, p.oldPrice, p.artStyle, p.imageUrl, p.isActive]);
      for (const v of variants) {
        await c.query('INSERT INTO variants (product_id, size, color_name, color_hex, stock) VALUES ($1,$2,$3,$4,$5)',
          [r.rows[0].id, v.size, v.colorName, v.colorHex, v.stock]);
      }
      return r.rows[0].id;
    }).catch((e) => {
      if (e.code === '23505') throw new HttpError(409, 'The same size and colour was listed twice');
      throw e;
    });
    res.status(201).json({ product: await loadAdminProduct(id) });
  });

  app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const p = readProduct(req.body);
    await withTransaction(async (c) => {
      const old = await c.query('SELECT price FROM products WHERE id = $1 FOR UPDATE', [id]);
      if (!old.rows[0]) throw new HttpError(404, 'Shoe not found');
      const bid = await brandId(c, p.brand);
      await c.query(
        `UPDATE products SET brand_id=$2, name=$3, type=$4, category=$5, description=$6, price=$7, old_price=$8,
                art_style=$9, image_url=$10, is_active=$11 WHERE id=$1`,
        [id, bid, p.name, p.type, p.category, p.description, p.price, p.oldPrice, p.artStyle, p.imageUrl, p.isActive]);
      // cheaper than before: tell everybody who saved the shoe or asked about it
      if (p.price < old.rows[0].price && p.isActive) {
        await notifyInterested(c, id, {
          kind: 'price_drop', title: 'Price drop',
          bodyFor: () => `The ${p.name} is now ${formatSom(p.price)}.`,
        });
      }
    });
    res.json({ product: await loadAdminProduct(id) });
  });

  app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    // Old orders keep their own copy of the name and price, so deleting a shoe never rewrites history.
    const r = await query('DELETE FROM products WHERE id = $1', [cleanId(req.params.id, 'id')]);
    if (r.rowCount === 0) throw new HttpError(404, 'Shoe not found');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- sizes, colours and stock
  app.post('/api/admin/products/:id/variants', requireAdmin, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const v = readVariant(req.body);
    try {
      const r = await query(
        `INSERT INTO variants (product_id, size, color_name, color_hex, stock)
         SELECT id, $2, $3, $4, $5 FROM products WHERE id = $1 RETURNING id, product_id, size, color_name, color_hex, stock`,
        [id, v.size, v.colorName, v.colorHex, v.stock]);
      if (!r.rows[0]) throw new HttpError(404, 'Shoe not found');
      res.status(201).json({ variant: variantJson(r.rows[0]) });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That size and colour already exists for this shoe');
      throw e;
    }
  });

  // Set the stock of one size. 0 -> more than 0 is a RESTOCK: people who saved the shoe or asked for an alert hear about it.
  app.put('/api/admin/variants/:id', requireAdmin, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const stock = cleanInt(req.body.stock, { min: 0, max: 1000, field: 'Stock' });
    const out = await withTransaction(async (c) => {
      const old = await c.query(
        `SELECT v.stock, v.size, v.product_id, p.name, p.is_active FROM variants v JOIN products p ON p.id = v.product_id
          WHERE v.id = $1 FOR UPDATE OF v`, [id]);
      if (!old.rows[0]) throw new HttpError(404, 'Size not found');
      const v = old.rows[0];
      await c.query('UPDATE variants SET stock = $2 WHERE id = $1', [id, stock]);
      let notified = 0;
      if (v.stock === 0 && stock > 0 && v.is_active) {
        notified = await notifyInterested(c, v.product_id, {
          kind: 'restock', title: 'Restock alert',
          bodyFor: (u) => (u.shoe_size_eu === v.size
            ? `The ${v.name} is back in stock in your size (${v.size}).`
            : `The ${v.name} is back in stock.`),
        });
        await c.query('DELETE FROM stock_alerts WHERE product_id = $1', [v.product_id]);   // an alert is used once
      }
      return { stock, notified };
    });
    res.json(out);
  });

  app.delete('/api/admin/variants/:id', requireAdmin, async (req, res) => {
    const r = await query('DELETE FROM variants WHERE id = $1', [cleanId(req.params.id, 'id')]);
    if (r.rowCount === 0) throw new HttpError(404, 'Size not found');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- orders
  app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    const status = req.query.status ? cleanChoice(req.query.status, ORDER_STATUSES, 'status') : null;
    const r = await query(
      `SELECT o.*, u.full_name AS customer_name, u.email AS customer_email
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ($1::text IS NULL OR o.status = $1)
        ORDER BY o.created_at DESC, o.id DESC LIMIT 200`, [status]);
    const items = await query('SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id', [r.rows.map((o) => o.id)]);
    const by = new Map();
    for (const i of items.rows) by.set(i.order_id, [...(by.get(i.order_id) || []), i]);
    res.json({
      orders: r.rows.map((o) => ({ ...orderJson(o, by.get(o.id) || []), customer: { name: o.customer_name, email: o.customer_email } })),
    });
  });

  app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const o = await query(
      `SELECT o.*, u.full_name AS customer_name, u.email AS customer_email
         FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [id]);
    if (!o.rows[0]) throw new HttpError(404, 'Order not found');
    const [items, log] = await Promise.all([
      query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]),
      query('SELECT status, created_at FROM order_status_log WHERE order_id = $1 ORDER BY created_at, id', [id]),
    ]);
    res.json({ order: { ...orderJson(o.rows[0], items.rows, log.rows), customer: { name: o.rows[0].customer_name, email: o.rows[0].customer_email } } });
  });

  // new -> processing -> shipped -> delivered (or cancelled); the customer is notified, a cancel puts the stock back
  app.patch('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const status = cleanChoice(req.body.status, ORDER_STATUSES, 'Status');
    const updated = await withTransaction((c) => setOrderStatus(c, id, status, req.user.id));
    const items = await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
    res.json({ order: orderJson(updated, items.rows) });
  });

  // ---------------------------------------------------------------- coupons
  app.get('/api/admin/coupons', requireAdmin, async (_req, res) => {
    const r = await query('SELECT code, percent, min_total, active, expires_at FROM coupons ORDER BY code');
    res.json({ coupons: r.rows.map((c) => ({ code: c.code, percent: c.percent, minTotal: c.min_total, active: c.active, expiresAt: c.expires_at })) });
  });

  app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) throw new HttpError(400, 'Code must be 3-20 letters or digits');
    const percent = cleanInt(req.body.percent, { min: 1, max: 90, field: 'Percent' });
    const minTotal = cleanInt(req.body.minTotal ?? 0, { min: 0, max: 100_000_000, field: 'Minimum order' });
    try {
      await query('INSERT INTO coupons (code, percent, min_total) VALUES ($1,$2,$3)', [code, percent, minTotal]);
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That coupon code already exists');
      throw e;
    }
    res.status(201).json({ coupon: { code, percent, minTotal, active: true, expiresAt: null } });
  });

  app.patch('/api/admin/coupons/:code', requireAdmin, async (req, res) => {
    const r = await query('UPDATE coupons SET active = $2 WHERE code = $1', [String(req.params.code).toUpperCase(), req.body.active === true]);
    if (r.rowCount === 0) throw new HttpError(404, 'Coupon not found');
    res.json({ ok: true });
  });

  app.delete('/api/admin/coupons/:code', requireAdmin, async (req, res) => {
    const r = await query('DELETE FROM coupons WHERE code = $1', [String(req.params.code).toUpperCase()]);
    if (r.rowCount === 0) throw new HttpError(404, 'Coupon not found');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- announce a new drop to every customer
  app.post('/api/admin/announce', requireAdmin, async (req, res) => {
    const title = cleanText(req.body.title || 'New drop alert', { min: 2, max: 60, field: 'Title' });
    const body = cleanText(req.body.body, { min: 2, max: 200, field: 'Message' });
    const productId = req.body.productId ? cleanId(req.body.productId, 'productId') : null;
    const sent = await withTransaction(async (c) => {
      if (productId) {
        const p = await c.query('SELECT 1 FROM products WHERE id = $1', [productId]);
        if (!p.rows[0]) throw new HttpError(404, 'Shoe not found');
      }
      const users = await c.query(`SELECT id FROM users WHERE role = 'customer'`);
      await notifyMany(c, users.rows.map((u) => u.id), { kind: 'drop', title, body, productId });
      return users.rows.length;
    });
    res.status(201).json({ sent });
  });

  // ---------------------------------------------------------------- customers
  app.get('/api/admin/customers', requireAdmin, async (_req, res) => {
    const r = await query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.created_at,
              count(o.id) FILTER (WHERE o.status <> 'cancelled')::int AS orders,
              COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS spent
         FROM users u LEFT JOIN orders o ON o.user_id = u.id
        WHERE u.role = 'customer' GROUP BY u.id ORDER BY spent DESC, u.created_at DESC`);
    res.json({ customers: r.rows.map((u) => ({ id: u.id, name: u.full_name, email: u.email, phone: u.phone || '', orders: u.orders, spent: u.spent, memberSince: u.created_at })) });
  });
}

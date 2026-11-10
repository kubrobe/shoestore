// Everything a logged-in customer does: favourites, back-in-stock alerts, cart, checkout, orders, notifications,
// addresses and the profile. The website and the Android app call exactly the same routes.
import bcrypt from 'bcryptjs';
import { query, withTransaction } from './db.js';
import { requireAuth, publicUser, sessionToken, revokeOtherSessions } from './auth.js';
import { HttpError, cleanId, cleanInt, cleanText, cleanPhone, cleanPassword, cleanChoice } from './validate.js';
import { cardColumns, CARD_FROM, productCard, orderJson, notificationJson, addressJson } from './shape.js';
import { MAX_QTY, PAYMENT_METHODS, priceOrder, loadCoupon } from './rules.js';
import { notify } from './notify.js';
import { setOrderStatus } from './orders.js';

const MAX_ADDRESSES = 5;

// ---------------------------------------------------------------- cart helpers (also used by the phone sync)
export async function loadCart(userId) {
  const r = await query(
    `SELECT ci.variant_id, ci.qty, v.size, v.color_name, v.color_hex, v.stock,
            p.id AS product_id, p.name, p.price, p.art_style, p.image_url, p.is_active, b.name AS brand
       FROM cart_items ci
       JOIN variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id
       JOIN brands b ON b.id = p.brand_id
      WHERE ci.user_id = $1 ORDER BY ci.created_at, ci.variant_id`, [userId]);
  const items = r.rows.map((x) => ({
    variantId: x.variant_id, productId: x.product_id, name: x.name, brand: x.brand, size: x.size,
    colorName: x.color_name, colorHex: x.color_hex, artStyle: x.art_style, imageUrl: x.image_url || null,
    unitPrice: x.price, qty: x.qty, stock: x.stock,
    available: x.is_active && x.stock >= x.qty,        // false = sold out / hidden / not enough left, checkout would refuse it
  }));
  return {
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    subtotal: items.reduce((n, i) => n + i.unitPrice * i.qty, 0),
    hasUnavailable: items.some((i) => !i.available),
  };
}

async function checkVariant(variantId, wantQty) {
  const r = await query(
    `SELECT v.id, v.stock, v.size, p.is_active, p.name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, [variantId]);
  const v = r.rows[0];
  if (!v || !v.is_active) throw new HttpError(404, 'This shoe is not available');
  if (wantQty > MAX_QTY) throw new HttpError(400, `You can order at most ${MAX_QTY} pairs of one size and colour`);
  if (v.stock === 0) throw new HttpError(409, `${v.name} in size ${v.size} is sold out`);
  if (wantQty > v.stock) throw new HttpError(409, `Only ${v.stock} left in size ${v.size}`);
}

export function shopRoutes(app) {
  // ---------------------------------------------------------------- header badges in one call
  app.get('/api/summary', requireAuth, async (req, res) => {
    const r = await query(
      `SELECT (SELECT COALESCE(SUM(qty), 0) FROM cart_items WHERE user_id = $1) AS cart_count,
              (SELECT count(*) FROM notifications WHERE user_id = $1 AND NOT is_read) AS unread,
              (SELECT count(*) FROM favourites WHERE user_id = $1) AS favourites,
              (SELECT count(*) FROM orders WHERE user_id = $1 AND status IN ('new', 'processing', 'shipped')) AS active_orders`, [req.user.id]);
    const x = r.rows[0];
    res.json({ cartCount: Number(x.cart_count), unreadCount: x.unread, favouriteCount: x.favourites, activeOrders: x.active_orders });
  });

  // ---------------------------------------------------------------- profile
  app.patch('/api/me', requireAuth, async (req, res) => {
    const b = req.body;
    const fullName = b.fullName !== undefined ? cleanText(b.fullName, { min: 2, max: 60, field: 'Name' }) : req.user.full_name;
    const phone = b.phone !== undefined ? cleanPhone(b.phone) : req.user.phone;
    const size = b.shoeSizeEu === undefined ? req.user.shoe_size_eu
      : b.shoeSizeEu === null || b.shoeSizeEu === '' ? null : cleanInt(b.shoeSizeEu, { min: 16, max: 50, field: 'Shoe size' });
    const r = await query(
      `UPDATE users SET full_name = $2, phone = $3, shoe_size_eu = $4 WHERE id = $1
       RETURNING id, email, full_name, phone, role, shoe_size_eu, created_at`, [req.user.id, fullName, phone, size]);
    res.json({ user: publicUser(r.rows[0]) });
  });

  app.post('/api/me/password', requireAuth, async (req, res) => {
    const next = cleanPassword(req.body.newPassword);
    const r = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.currentPassword || ''), r.rows[0].password_hash))) {
      throw new HttpError(400, 'Your current password is not correct');
    }
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(next, 10)]);
    await revokeOtherSessions(req.user.id, sessionToken(req));      // every other phone / browser must log in again
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- favourites
  app.get('/api/favourites', requireAuth, async (req, res) => {
    const r = await query(
      `SELECT ${cardColumns('$1')} ${CARD_FROM}
         JOIN favourites fv ON fv.product_id = p.id AND fv.user_id = $1
        WHERE p.is_active ORDER BY fv.created_at DESC`, [req.user.id]);
    res.json({ products: r.rows.map(productCard) });
  });

  async function requireProduct(id) {
    const r = await query('SELECT 1 FROM products WHERE id = $1 AND is_active', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Shoe not found');
  }

  app.put('/api/favourites/:productId', requireAuth, async (req, res) => {
    const id = cleanId(req.params.productId, 'productId');
    await requireProduct(id);
    await query('INSERT INTO favourites (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, id]);
    res.json({ isFavourite: true });
  });

  app.delete('/api/favourites/:productId', requireAuth, async (req, res) => {
    await query('DELETE FROM favourites WHERE user_id = $1 AND product_id = $2', [req.user.id, cleanId(req.params.productId, 'productId')]);
    res.json({ isFavourite: false });
  });

  // ---------------------------------------------------------------- "tell me when it is back in stock"
  app.put('/api/products/:id/alert', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    await requireProduct(id);
    await query('INSERT INTO stock_alerts (user_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, id]);
    res.json({ hasAlert: true });
  });

  app.delete('/api/products/:id/alert', requireAuth, async (req, res) => {
    await query('DELETE FROM stock_alerts WHERE user_id = $1 AND product_id = $2', [req.user.id, cleanId(req.params.id, 'id')]);
    res.json({ hasAlert: false });
  });

  // ---------------------------------------------------------------- cart
  app.get('/api/cart', requireAuth, async (req, res) => res.json(await loadCart(req.user.id)));

  // POST = "add this many more" (the Add to cart button)
  app.post('/api/cart/items', requireAuth, async (req, res) => {
    const variantId = cleanId(req.body.variantId, 'variantId');
    const add = req.body.qty === undefined ? 1 : cleanInt(req.body.qty, { min: 1, max: MAX_QTY, field: 'Quantity' });
    const have = await query('SELECT qty FROM cart_items WHERE user_id = $1 AND variant_id = $2', [req.user.id, variantId]);
    const total = (have.rows[0]?.qty ?? 0) + add;
    await checkVariant(variantId, total);
    await query(
      `INSERT INTO cart_items (user_id, variant_id, qty) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, variant_id) DO UPDATE SET qty = EXCLUDED.qty`, [req.user.id, variantId, total]);
    res.status(201).json(await loadCart(req.user.id));
  });

  // PUT = "set the quantity to exactly this" (the + / - buttons in the cart); 0 removes the line
  app.put('/api/cart/items/:variantId', requireAuth, async (req, res) => {
    const variantId = cleanId(req.params.variantId, 'variantId');
    const qty = cleanInt(req.body.qty, { min: 0, max: MAX_QTY, field: 'Quantity' });
    if (qty === 0) {
      await query('DELETE FROM cart_items WHERE user_id = $1 AND variant_id = $2', [req.user.id, variantId]);
    } else {
      await checkVariant(variantId, qty);
      const r = await query('UPDATE cart_items SET qty = $3 WHERE user_id = $1 AND variant_id = $2', [req.user.id, variantId, qty]);
      if (r.rowCount === 0) throw new HttpError(404, 'That item is not in your cart');
    }
    res.json(await loadCart(req.user.id));
  });

  app.delete('/api/cart/items/:variantId', requireAuth, async (req, res) => {
    await query('DELETE FROM cart_items WHERE user_id = $1 AND variant_id = $2', [req.user.id, cleanId(req.params.variantId, 'variantId')]);
    res.json(await loadCart(req.user.id));
  });

  app.delete('/api/cart', requireAuth, async (req, res) => {
    await query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
    res.json(await loadCart(req.user.id));
  });

  // ---------------------------------------------------------------- addresses
  app.get('/api/addresses', requireAuth, async (req, res) => {
    const r = await query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id', [req.user.id]);
    res.json({ addresses: r.rows.map(addressJson) });
  });

  const readAddress = (b) => ({
    label: cleanText(b.label || 'Home', { min: 1, max: 30, field: 'Label' }),
    line: cleanText(b.line, { min: 5, max: 200, field: 'Address' }),
    city: cleanText(b.city, { min: 2, max: 60, field: 'City' }),
    phone: cleanPhone(b.phone, { required: true }),
    isDefault: b.isDefault === true,
  });

  app.post('/api/addresses', requireAuth, async (req, res) => {
    const a = readAddress(req.body);
    const created = await withTransaction(async (c) => {
      const n = await c.query('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1', [req.user.id]);
      if (n.rows[0].n >= MAX_ADDRESSES) throw new HttpError(400, `You can save at most ${MAX_ADDRESSES} addresses`);
      const makeDefault = a.isDefault || n.rows[0].n === 0;
      if (makeDefault) await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
      const r = await c.query(
        'INSERT INTO addresses (user_id, label, line, city, phone, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [req.user.id, a.label, a.line, a.city, a.phone, makeDefault]);
      return r.rows[0];
    });
    res.status(201).json({ address: addressJson(created) });
  });

  app.put('/api/addresses/:id', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const a = readAddress(req.body);
    const updated = await withTransaction(async (c) => {
      if (a.isDefault) await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1 AND id <> $2', [req.user.id, id]);
      const r = await c.query(
        `UPDATE addresses SET label = $3, line = $4, city = $5, phone = $6, is_default = is_default OR $7
          WHERE id = $1 AND user_id = $2 RETURNING *`, [id, req.user.id, a.label, a.line, a.city, a.phone, a.isDefault]);
      if (!r.rows[0]) throw new HttpError(404, 'Address not found');
      return r.rows[0];
    });
    res.json({ address: addressJson(updated) });
  });

  app.delete('/api/addresses/:id', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    await withTransaction(async (c) => {
      const r = await c.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default', [id, req.user.id]);
      if (!r.rows[0]) throw new HttpError(404, 'Address not found');
      if (r.rows[0].is_default) {      // the oldest remaining address becomes the default
        await c.query(`UPDATE addresses SET is_default = true WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY id LIMIT 1)`, [req.user.id]);
      }
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- price preview and checkout
  app.post('/api/checkout/quote', requireAuth, async (req, res) => {
    const cart = await loadCart(req.user.id);
    const coupon = await loadCoupon({ query }, req.body.coupon, cart.subtotal);
    res.json({ ...priceOrder(cart.subtotal, coupon?.percent ?? 0), coupon: coupon ? { code: coupon.code, percent: coupon.percent } : null });
  });

  // ONE transaction: lock the size rows, check the stock, take it off, write the order, empty the cart.
  // If anything fails, nothing at all is saved (no half-orders, no stock lost).
  app.post('/api/checkout', requireAuth, async (req, res) => {
    const payment = cleanChoice(req.body.paymentMethod, PAYMENT_METHODS, 'Payment method');

    let address;
    if (req.body.addressId !== undefined && req.body.addressId !== null) {
      const r = await query('SELECT line, city, phone FROM addresses WHERE id = $1 AND user_id = $2', [cleanId(req.body.addressId, 'addressId'), req.user.id]);
      if (!r.rows[0]) throw new HttpError(404, 'Address not found');
      address = r.rows[0];
    } else {
      const a = req.body.address || {};
      address = {
        line: cleanText(a.line, { min: 5, max: 200, field: 'Address' }),
        city: cleanText(a.city, { min: 2, max: 60, field: 'City' }),
        phone: cleanPhone(a.phone, { required: true }),
      };
    }

    const order = await withTransaction(async (c) => {
      const cart = await c.query(
        `SELECT ci.variant_id, ci.qty, v.product_id, v.size, v.color_name, v.color_hex, v.stock,
                p.name, p.price, p.art_style, p.is_active, b.name AS brand
           FROM cart_items ci
           JOIN variants v ON v.id = ci.variant_id
           JOIN products p ON p.id = v.product_id
           JOIN brands b ON b.id = p.brand_id
          WHERE ci.user_id = $1
          ORDER BY ci.variant_id
            FOR UPDATE OF v`, [req.user.id]);                  // locked in id order, so two checkouts can never deadlock
      if (cart.rows.length === 0) throw new HttpError(400, 'Your cart is empty');

      for (const it of cart.rows) {
        if (!it.is_active) throw new HttpError(409, `${it.name} is no longer available. Please remove it from your cart.`);
        if (it.stock < it.qty) {
          throw new HttpError(409, it.stock === 0
            ? `${it.name} (size ${it.size}, ${it.color_name}) just sold out. Please remove it from your cart.`
            : `Only ${it.stock} left of ${it.name} (size ${it.size}, ${it.color_name}).`);
        }
        const upd = await c.query('UPDATE variants SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [it.variant_id, it.qty]);
        if (upd.rowCount !== 1) throw new HttpError(409, `${it.name} just sold out. Please try again.`);
      }

      const subtotal = cart.rows.reduce((n, it) => n + it.price * it.qty, 0);
      const coupon = await loadCoupon(c, req.body.coupon, subtotal);
      const price = priceOrder(subtotal, coupon?.percent ?? 0);

      const o = (await c.query(
        `INSERT INTO orders (user_id, subtotal, shipping_fee, discount, total, coupon_code, address_line, city, phone, payment_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.user.id, price.subtotal, price.shipping, price.discount, price.total, coupon?.code ?? null,
         address.line, address.city, address.phone, payment])).rows[0];

      const items = [];
      for (const it of cart.rows) {
        const row = (await c.query(
          `INSERT INTO order_items (order_id, variant_id, product_id, product_name, brand_name, size, color_name, color_hex, art_style, unit_price, qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [o.id, it.variant_id, it.product_id, it.name, it.brand, it.size, it.color_name, it.color_hex, it.art_style, it.price, it.qty])).rows[0];
        items.push(row);
      }
      await c.query('INSERT INTO order_status_log (order_id, status, changed_by) VALUES ($1,$2,$3)', [o.id, 'new', req.user.id]);
      await c.query('DELETE FROM cart_items WHERE user_id = $1', [req.user.id]);
      await notify(c, req.user.id, {
        kind: 'order', title: 'Order placed',
        body: `We received your ${items[0].product_name}${items.length > 1 ? ` and ${items.length - 1} more` : ''} order. Thank you!`,
        orderId: o.id,
      });
      return orderJson(o, items);
    });
    res.status(201).json({ order });
  });

  // ---------------------------------------------------------------- orders
  async function itemsOf(orderIds) {
    if (orderIds.length === 0) return new Map();
    const r = await query('SELECT * FROM order_items WHERE order_id = ANY($1::int[]) ORDER BY id', [orderIds]);
    const byOrder = new Map();
    for (const i of r.rows) byOrder.set(i.order_id, [...(byOrder.get(i.order_id) || []), i]);
    return byOrder;
  }

  app.get('/api/orders', requireAuth, async (req, res) => {
    const r = await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [req.user.id]);
    const items = await itemsOf(r.rows.map((o) => o.id));
    res.json({ orders: r.rows.map((o) => orderJson(o, items.get(o.id) || [])) });
  });

  app.get('/api/orders/:id', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const o = await query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!o.rows[0]) throw new HttpError(404, 'Order not found');
    const [items, log] = await Promise.all([
      itemsOf([id]),
      query('SELECT status, created_at FROM order_status_log WHERE order_id = $1 ORDER BY created_at, id', [id]),
    ]);
    res.json({ order: orderJson(o.rows[0], items.get(id) || [], log.rows) });
  });

  // A customer can cancel until the parcel is on its way.
  app.post('/api/orders/:id/cancel', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    await withTransaction(async (c) => {
      const o = await c.query('SELECT status FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, req.user.id]);
      if (!o.rows[0]) throw new HttpError(404, 'Order not found');
      if (!['new', 'processing'].includes(o.rows[0].status)) throw new HttpError(409, 'This order is already on its way and can no longer be cancelled');
      await setOrderStatus(c, id, 'cancelled', req.user.id);
    });
    const o = await query('SELECT * FROM orders WHERE id = $1', [id]);
    const items = await itemsOf([id]);
    res.json({ order: orderJson(o.rows[0], items.get(id) || []) });
  });

  // ---------------------------------------------------------------- notifications
  app.get('/api/notifications', requireAuth, async (req, res) => {
    const [list, unread] = await Promise.all([
      query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50', [req.user.id]),
      query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user.id]),
    ]);
    res.json({ notifications: list.rows.map(notificationJson), unreadCount: unread.rows[0].n });
  });

  app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND NOT is_read', [req.user.id]);
    res.json({ ok: true });
  });

  app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
    const r = await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [cleanId(req.params.id, 'id'), req.user.id]);
    if (r.rowCount === 0) throw new HttpError(404, 'Notification not found');
    res.json({ ok: true });
  });
}

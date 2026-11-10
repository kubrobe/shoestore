// The Android app keeps an offline copy (Room database). ONE call gives it everything it needs to rebuild that copy,
// so the phone never shows half-updated data: GET /api/mobile/sync  ->  { shop, user, cart, orders, notifications, ... }
// (login / register / logout for the app live in auth.js under /api/mobile/*).
import { query } from './db.js';
import { requireAuth, publicUser } from './auth.js';
import { cardColumns, CARD_FROM, productCard, variantJson, orderJson, notificationJson, addressJson } from './shape.js';
import { loadMeta } from './catalog.js';
import { loadCart } from './shop.js';

export function mobileRoutes(app) {
  app.get('/api/mobile/sync', requireAuth, async (req, res) => {
    const uid = req.user.id;
    const [meta, products, variants, orders, orderItems, notifications, addresses, alerts, cart] = await Promise.all([
      loadMeta(),
      query(`SELECT ${cardColumns('$1')} ${CARD_FROM} WHERE p.is_active ORDER BY p.id`, [uid]),
      query(`SELECT v.id, v.product_id, v.size, v.color_name, v.color_hex, v.stock
               FROM variants v JOIN products p ON p.id = v.product_id WHERE p.is_active ORDER BY v.product_id, v.color_name, v.size`),
      query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [uid]),
      query(`SELECT oi.* FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = $1 ORDER BY oi.id`, [uid]),
      query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50', [uid]),
      query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id', [uid]),
      query('SELECT product_id FROM stock_alerts WHERE user_id = $1', [uid]),
      loadCart(uid),
    ]);

    const variantsBy = new Map();
    for (const v of variants.rows) variantsBy.set(v.product_id, [...(variantsBy.get(v.product_id) || []), variantJson(v)]);
    const itemsBy = new Map();
    for (const i of orderItems.rows) itemsBy.set(i.order_id, [...(itemsBy.get(i.order_id) || []), i]);

    res.json({
      syncedAt: new Date().toISOString(),
      meta,
      user: publicUser(req.user),
      products: products.rows.map((r) => ({ ...productCard(r), variants: variantsBy.get(r.id) || [] })),
      stockAlertProductIds: alerts.rows.map((a) => a.product_id),
      cart,
      addresses: addresses.rows.map(addressJson),
      orders: orders.rows.map((o) => orderJson(o, itemsBy.get(o.id) || [])),
      notifications: notifications.rows.map(notificationJson),
      unreadCount: notifications.rows.filter((n) => !n.is_read).length,
    });
  });
}

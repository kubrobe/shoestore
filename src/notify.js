// Notifications: price drops, restocks, new drops, order updates. They are rows in the notifications table,
// so the website and the Android app (which both read that table) show exactly the same list.

// One notification for one user. `db` is the pool or a transaction client.
export const notify = (db, userId, { kind, title, body, productId = null, orderId = null }) =>
  db.query(
    `INSERT INTO notifications (user_id, kind, title, body, product_id, order_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, kind, title, body, productId, orderId]);

// The same notification for many users at once
export const notifyMany = (db, userIds, { kind, title, body, productId = null, orderId = null }) =>
  userIds.length === 0 ? null : db.query(
    `INSERT INTO notifications (user_id, kind, title, body, product_id, order_id)
     SELECT uid, $2, $3, $4, $5, $6 FROM unnest($1::int[]) AS uid`,
    [userIds, kind, title, body, productId, orderId]);

// Notify everybody who saved the shoe or asked to be told about it, but each person only once.
// Used for price drops and restocks. `bodyFor(user)` can personalise the text (for example "in your size").
export async function notifyInterested(db, productId, { kind, title, bodyFor }) {
  const r = await db.query(
    `SELECT u.id, u.shoe_size_eu FROM users u
      WHERE u.role = 'customer'
        AND (EXISTS (SELECT 1 FROM favourites f WHERE f.user_id = u.id AND f.product_id = $1)
          OR EXISTS (SELECT 1 FROM stock_alerts a WHERE a.user_id = u.id AND a.product_id = $1))`, [productId]);
  for (const u of r.rows) await notify(db, u.id, { kind, title, body: bodyFor(u), productId });
  return r.rows.length;
}

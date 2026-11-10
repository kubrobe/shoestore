// Changing the status of an order. Used by the shop owner (admin) AND by a customer cancelling their own order,
// so the rules (allowed next status, putting the stock back, the history line, the notification) live in one place.
import { HttpError } from './validate.js';
import { NEXT_STATUS, statusMessage } from './rules.js';
import { notify } from './notify.js';

// Must run inside a transaction (`client` comes from withTransaction). Returns the updated order row.
export async function setOrderStatus(client, orderId, newStatus, changedBy) {
  const found = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  const order = found.rows[0];
  if (!order) throw new HttpError(404, 'Order not found');
  if (!(NEXT_STATUS[order.status] || []).includes(newStatus)) {
    throw new HttpError(409, `An order that is "${order.status}" cannot be changed to "${newStatus}"`);
  }

  if (newStatus === 'cancelled') {
    // the pairs go back on the shelf
    await client.query(
      `UPDATE variants v SET stock = v.stock + oi.qty
         FROM order_items oi WHERE oi.order_id = $1 AND oi.variant_id = v.id`, [orderId]);
  }

  const upd = await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [orderId, newStatus]);
  await client.query('INSERT INTO order_status_log (order_id, status, changed_by) VALUES ($1,$2,$3)', [orderId, newStatus, changedBy]);

  const items = await client.query('SELECT product_name FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  const first = items.rows[0]?.product_name ?? 'Shushop';
  await notify(client, order.user_id, {
    kind: 'order',
    title: newStatus === 'delivered' ? 'Order delivered' : 'Order update',
    body: statusMessage(newStatus, first, Math.max(0, items.rows.length - 1)),
    orderId,
  });
  return upd.rows[0];
}

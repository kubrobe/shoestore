import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, pool, shoe, pick, setStock, stockOf, count, ADDRESS } from './helpers.js';
import { SHIPPING_FEE } from '../src/rules.js';

let t, alex, bobur, admin;
before(async () => {
  t = await startApp();
  alex = await t.login('alex@demo.uz');
  bobur = await t.login('bobur@demo.uz');
  admin = await t.login('admin@shushop.uz', 'admin12345');
});
after(() => t.stop());

const addToCart = (token, variantId, qty = 1) => t.call('POST', '/api/cart/items', { token, body: { variantId, qty } });
const checkout = (token, body = {}) => t.call('POST', '/api/checkout', { token, body: { address: ADDRESS, paymentMethod: 'cash', ...body } });
const clearCart = (token) => t.call('DELETE', '/api/cart', { token });

test('cart: add, merge the same pair, change the quantity, remove', async () => {
  const swift = await shoe(t, 'Swift Run');
  const v = pick(swift);
  let r = await addToCart(alex, v.id, 2);
  assert.equal(r.status, 201);
  assert.equal(r.body.count, 2);
  assert.equal(r.body.subtotal, 1280000);
  r = await addToCart(alex, v.id, 1);
  assert.equal(r.body.items.length, 1, 'the same size and colour is one line');
  assert.equal(r.body.items[0].qty, 3);
  r = await t.call('PUT', `/api/cart/items/${v.id}`, { token: alex, body: { qty: 1 } });
  assert.equal(r.body.count, 1);
  r = await t.call('PUT', `/api/cart/items/${v.id}`, { token: alex, body: { qty: 0 } });
  assert.equal(r.body.items.length, 0);
  assert.equal((await t.call('PUT', `/api/cart/items/${v.id}`, { token: alex, body: { qty: 2 } })).status, 404, 'cannot set a line that is not in the cart');
});

test('cart refuses more than the stock, more than the limit, and shoes that do not exist', async () => {
  const v = pick(await shoe(t, 'Swift Run'));
  await setStock(v.id, 2);
  const over = await addToCart(alex, v.id, 3);
  assert.equal(over.status, 409);
  assert.match(over.body.error, /Only 2 left/);
  await setStock(v.id, 0);
  assert.match((await addToCart(alex, v.id, 1)).body.error, /sold out/);
  await setStock(v.id, 50);
  assert.equal((await addToCart(alex, v.id, 11)).status, 400);
  assert.equal((await addToCart(alex, 999999, 1)).status, 404);
  assert.equal((await addToCart(alex, 'abc', 1)).status, 400);
  assert.equal((await addToCart(alex, v.id, 0)).status, 400);
  await clearCart(alex);
});

test('checkout takes the stock, keeps a price snapshot, empties the cart and notifies the customer', async () => {
  const v = pick(await shoe(t, 'Swift Run'));
  const stock0 = await stockOf(v.id);
  const orders0 = await count('orders');
  await addToCart(alex, v.id, 2);
  const r = await checkout(alex, { paymentMethod: 'payme' });
  assert.equal(r.status, 201);
  const o = r.body.order;
  assert.equal(o.status, 'new');
  assert.equal(o.subtotal, 1280000);
  assert.equal(o.shippingFee, 0, 'free shipping from 500 000');
  assert.equal(o.total, 1280000);
  assert.equal(o.items[0].unitPrice, 640000);
  assert.equal(o.items[0].name, 'Swift Run');
  assert.equal(o.paymentMethod, 'payme');
  assert.equal(await stockOf(v.id), stock0 - 2);
  assert.equal(await count('orders'), orders0 + 1);
  assert.equal((await t.call('GET', '/api/cart', { token: alex })).body.count, 0);
  assert.equal(await count('order_status_log', 'order_id = $1', [o.id]), 1);
  const notes = (await t.call('GET', '/api/notifications', { token: alex })).body.notifications;
  assert.ok(notes.some((n) => n.kind === 'order' && n.orderId === o.id && n.title === 'Order placed'));
});

test('shipping is charged under 500 000 and free from 500 000 (after the discount)', async () => {
  const kid = pick(await shoe(t, 'Little Spark'));                    // 330 000
  await addToCart(alex, kid.id, 1);
  const small = await checkout(alex);
  assert.equal(small.body.order.shippingFee, SHIPPING_FEE);
  assert.equal(small.body.order.total, 330000 + SHIPPING_FEE);

  await pool.query(`INSERT INTO coupons (code, percent, min_total) VALUES ('HALF', 50, 0)`);
  const court = pick(await shoe(t, 'Court Classic'));                  // 560 000, but only 280 000 after 50 %
  await addToCart(alex, court.id, 1);
  const q = await t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon: 'half' } });
  assert.deepEqual([q.body.subtotal, q.body.discount, q.body.shipping, q.body.total], [560000, 280000, SHIPPING_FEE, 305000]);
  const r = await checkout(alex, { coupon: 'HALF' });
  assert.equal(r.body.order.total, 305000);
  assert.equal(r.body.order.couponCode, 'HALF');
});

test('coupons: percent off, minimum order, unknown code, inactive code', async () => {
  const swift = pick(await shoe(t, 'Swift Run'));                      // 640 000
  await addToCart(alex, swift.id, 1);
  const ten = await t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon: 'WELCOME10' } });
  assert.deepEqual([ten.body.discount, ten.body.total], [64000, 576000]);
  const fifteen = await t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon: 'SNEAKER15' } });
  assert.equal(fifteen.body.discount, 96000);
  assert.equal((await t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon: 'NOPE' } })).status, 400);
  assert.equal((await t.call('POST', '/api/checkout/quote', { token: alex, body: {} })).body.total, 640000, 'no code = no discount');
  await pool.query(`UPDATE coupons SET active = false WHERE code = 'WELCOME10'`);
  assert.equal((await t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon: 'WELCOME10' } })).status, 400);
  await pool.query(`UPDATE coupons SET active = true WHERE code = 'WELCOME10'`);

  await clearCart(alex);
  const kid = pick(await shoe(t, 'Little Spark'));
  await addToCart(alex, kid.id, 1);
  const tooSmall = await t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon: 'SNEAKER15' } });
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.body.error, /at least 600 000/);
  await clearCart(alex);
});

test('checkout input is validated and an empty cart cannot be bought', async () => {
  assert.equal((await checkout(alex)).status, 400, 'empty cart');
  const v = pick(await shoe(t, 'Swift Run'));
  await addToCart(alex, v.id, 1);
  const stock = await stockOf(v.id);
  assert.equal((await checkout(alex, { paymentMethod: 'bitcoin' })).status, 400);
  assert.equal((await checkout(alex, { address: { line: 'x', city: 'T', phone: '1' } })).status, 400);
  assert.equal((await checkout(alex, { addressId: 999999 })).status, 404);
  const aziza = await t.login('aziza@demo.uz');
  const hers = (await t.call('GET', '/api/addresses', { token: aziza })).body.addresses[0];
  assert.equal((await checkout(alex, { addressId: hers.id })).status, 404, "another customer's address cannot be used");
  assert.equal(await stockOf(v.id), stock, 'failed checkouts take nothing');
  const home = (await t.call('GET', '/api/addresses', { token: alex })).body.addresses.find((a) => a.isDefault);
  const saved = await checkout(alex, { addressId: home.id, address: undefined });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.order.addressLine, home.line, 'the saved address is copied into the order');
});

test('two buyers, one last pair: exactly one order, stock never below zero', async () => {
  const v = pick(await shoe(t, 'Aero Knit'));
  await setStock(v.id, 1);
  await addToCart(alex, v.id, 1);
  await addToCart(bobur, v.id, 1);
  const orders0 = await count('orders');
  const [a, b] = await Promise.all([checkout(alex), checkout(bobur)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(await stockOf(v.id), 0);
  assert.equal(await count('orders'), orders0 + 1);
  const loser = a.status === 409 ? a : b;
  assert.match(loser.body.error, /sold out|Only 0 left/);
  await clearCart(alex); await clearCart(bobur);
});

test('ten buyers at once for 3 pairs: 3 orders, 7 refusals, stock exactly 0', async () => {
  const v = pick(await shoe(t, 'Night Runner'), { min: 1 });
  await setStock(v.id, 3);
  const buyers = [];
  for (let i = 0; i < 10; i++) {
    const reg = await t.call('POST', '/api/mobile/register', { body: { email: `race${i}@test.uz`, password: 'secret123', full_name: `Racer ${i}` } });
    await addToCart(reg.body.token, v.id, 1);
    buyers.push(reg.body.token);
  }
  const results = await Promise.all(buyers.map((tok) => checkout(tok)));
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(results.filter((r) => r.status === 409).length, 7);
  assert.equal(await stockOf(v.id), 0);
});

test('a checkout that fails half-way changes nothing (all or nothing)', async () => {
  const a = pick(await shoe(t, 'Metro Hi'));
  const b = pick(await shoe(t, 'Pixel Low'));
  await setStock(a.id, 5); await setStock(b.id, 2);
  await addToCart(alex, a.id, 2);
  await addToCart(alex, b.id, 2);
  await setStock(b.id, 1);                        // somebody else bought a pair in the meantime
  const orders0 = await count('orders');
  const r = await checkout(alex);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Only 1 left of Pixel Low/);
  assert.equal(await stockOf(a.id), 5, 'the first line was rolled back too');
  assert.equal(await stockOf(b.id), 1);
  assert.equal(await count('orders'), orders0);
  assert.equal((await t.call('GET', '/api/cart', { token: alex })).body.items.length, 2, 'the cart is still there to fix');
  assert.equal((await t.call('GET', '/api/cart', { token: alex })).body.hasUnavailable, true);
  await clearCart(alex);
});

test('a hidden shoe cannot be bought even if it is still in a cart', async () => {
  const v = pick(await shoe(t, 'Kid Hero'));
  await addToCart(alex, v.id, 1);
  await pool.query(`UPDATE products SET is_active = false WHERE name = 'Kid Hero'`);
  const r = await checkout(alex);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no longer available/);
  await pool.query(`UPDATE products SET is_active = true WHERE name = 'Kid Hero'`);
  await clearCart(alex);
});

test('old orders keep their price and name when the shop changes the shoe or deletes it', async () => {
  const v = pick(await shoe(t, 'Heritage Loafer'));
  await addToCart(bobur, v.id, 1);
  const order = (await checkout(bobur)).body.order;
  const detail = (await t.call('GET', `/api/admin/products/${v.productId}`, { token: admin })).body.product;
  const edit = await t.call('PUT', `/api/admin/products/${v.productId}`, {
    token: admin, body: { name: 'Heritage Loafer 2', brand: 'Atlas', type: 'Casual', category: 'men', description: '', price: 999000, artStyle: 'slip' },
  });
  assert.equal(edit.status, 200);
  assert.equal(detail.price, 880000);
  let mine = (await t.call('GET', `/api/orders/${order.id}`, { token: bobur })).body.order;
  assert.equal(mine.items[0].unitPrice, 880000);
  assert.equal(mine.items[0].name, 'Heritage Loafer');
  assert.equal((await t.call('DELETE', `/api/admin/products/${v.productId}`, { token: admin })).status, 200);
  mine = (await t.call('GET', `/api/orders/${order.id}`, { token: bobur })).body.order;
  assert.equal(mine.items[0].name, 'Heritage Loafer', 'the order still reads correctly');
  assert.equal(mine.items[0].productId, null);
  assert.equal(mine.total, 880000);
});

test('cancelling puts the pairs back; shipped orders cannot be cancelled; orders are private', async () => {
  const v = pick(await shoe(t, 'Street Pulse'));
  const stock0 = await stockOf(v.id);
  await addToCart(alex, v.id, 2);
  const order = (await checkout(alex)).body.order;
  assert.equal(await stockOf(v.id), stock0 - 2);

  assert.equal((await t.call('GET', `/api/orders/${order.id}`, { token: bobur })).status, 404, "bobur cannot read alex's order");
  assert.equal((await t.call('POST', `/api/orders/${order.id}/cancel`, { token: bobur })).status, 404);

  const c = await t.call('POST', `/api/orders/${order.id}/cancel`, { token: alex });
  assert.equal(c.status, 200);
  assert.equal(c.body.order.status, 'cancelled');
  assert.equal(await stockOf(v.id), stock0, 'stock is back');
  assert.equal((await t.call('POST', `/api/orders/${order.id}/cancel`, { token: alex })).status, 409, 'cannot cancel twice');

  const shipped = (await pool.query(`SELECT id FROM orders WHERE status = 'shipped' AND user_id = (SELECT id FROM users WHERE email = 'alex@demo.uz')`)).rows[0].id;
  const r = await t.call('POST', `/api/orders/${shipped}/cancel`, { token: alex });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /on its way/);
});

test('order list and detail show items and the status history', async () => {
  const list = (await t.call('GET', '/api/orders', { token: alex })).body.orders;
  assert.ok(list.length >= 3);
  assert.ok(list[0].createdAt >= list[list.length - 1].createdAt, 'newest first');
  const seeded = list.find((o) => o.status === 'delivered' && o.items[0].name === 'Court Classic');
  const d = (await t.call('GET', `/api/orders/${seeded.id}`, { token: alex })).body.order;
  assert.deepEqual(d.history.map((h) => h.status), ['new', 'processing', 'shipped', 'delivered']);
  assert.equal(d.itemCount, 1);
});

test('addresses: first one becomes the default, one default at a time, limit of five', async () => {
  const reg = await t.call('POST', '/api/mobile/register', { body: { email: 'addr@test.uz', password: 'secret123', full_name: 'Addr Test' } });
  const tok = reg.body.token;
  const mk = (label, isDefault) => t.call('POST', '/api/addresses', { token: tok, body: { label, line: `${label} street 1, flat 2`, city: 'Tashkent', phone: '+998 90 123 45 67', isDefault } });
  const first = await mk('Home', false);
  assert.equal(first.body.address.isDefault, true);
  const second = await mk('Work', true);
  assert.equal(second.body.address.isDefault, true);
  let all = (await t.call('GET', '/api/addresses', { token: tok })).body.addresses;
  assert.equal(all.filter((a) => a.isDefault).length, 1);
  assert.equal(all[0].label, 'Work');
  assert.equal((await t.call('DELETE', `/api/addresses/${second.body.address.id}`, { token: tok })).status, 200);
  all = (await t.call('GET', '/api/addresses', { token: tok })).body.addresses;
  assert.equal(all.length, 1);
  assert.equal(all[0].isDefault, true, 'the remaining address took over as default');
  for (const n of ['A', 'B', 'C', 'D']) assert.equal((await mk(n, false)).status, 201);
  assert.equal((await mk('F', false)).status, 400, 'six addresses are too many');
  assert.equal((await t.call('PUT', '/api/addresses/999999', { token: tok, body: { line: 'Somewhere 12', city: 'Tashkent', phone: '+998 90 123 45 67' } })).status, 404);
  assert.equal((await t.call('DELETE', '/api/addresses/1', { token: tok })).status, 404, "alex's address is not yours");
});

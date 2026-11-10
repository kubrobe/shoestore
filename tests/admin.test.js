import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, shoe, pick, count, ADDRESS } from './helpers.js';

let t, alex, aziza, bobur, admin;
before(async () => {
  t = await startApp();
  alex = await t.login('alex@demo.uz');
  aziza = await t.login('aziza@demo.uz');
  bobur = await t.login('bobur@demo.uz');
  admin = await t.login('admin@shushop.uz', 'admin12345');
});
after(() => t.stop());

const A = (method, path, body) => t.call(method, path, { token: admin, body });
const notes = async (token) => (await t.call('GET', '/api/notifications', { token })).body.notifications;
const productBody = (p, over = {}) => ({
  name: p.name, brand: p.brand, type: p.type, category: p.category, description: p.description, price: p.price,
  oldPrice: p.oldPrice, artStyle: p.artStyle, imageUrl: p.imageUrl, isActive: p.isActive, ...over,
});

test('dashboard numbers match the data', async () => {
  const s = (await A('GET', '/api/admin/stats')).body;
  assert.equal(s.ordersTotal, 3);
  assert.equal(s.customers, 3);
  assert.equal(s.products, 16);
  assert.equal(s.revenue, 560000 + 640000 + 580000);
  assert.deepEqual(s.ordersByStatus, { new: 0, processing: 0, shipped: 1, delivered: 2, cancelled: 0 });
  assert.equal(s.last7Days.length, 7);
  assert.ok(s.soldOutVariants >= 1);
  assert.ok(s.lowStock.some((l) => l.name === 'Urban Step' && l.size === 42 && l.stock === 1));
  assert.ok(s.topProducts.length >= 1);
});

test('creating a shoe in the admin makes it appear in the shop at once, with its sizes', async () => {
  const body = {
    name: 'Dune Walker', brand: 'Atlas', type: 'Casual', category: 'unisex', description: 'Sand-coloured test shoe', price: 610000,
    artStyle: 'chunky',
    variants: [38, 39, 40].map((size) => ({ size, colorName: 'Sand', colorHex: '#c9b79c', stock: 4 })),
  };
  const r = await A('POST', '/api/admin/products', body);
  assert.equal(r.status, 201);
  assert.equal(r.body.product.variants.length, 3);
  const inShop = (await t.call('GET', '/api/products?search=dune')).body.products;
  assert.equal(inShop.length, 1);
  assert.deepEqual(inShop[0].sizesInStock, [38, 39, 40]);
  // a brand that did not exist is created, an existing one is reused (any capitalisation)
  const again = await A('POST', '/api/admin/products', { ...body, name: 'Dune Walker 2', brand: 'NEWBRAND' });
  assert.equal(again.status, 201);
  assert.ok((await t.call('GET', '/api/meta')).body.brands.includes('NEWBRAND'));
  assert.equal(await count('brands', `lower(name) = 'atlas'`), 1);
});

test('the admin form rejects bad data', async () => {
  const ok = { name: 'Bad Test', brand: 'Kora', category: 'men', price: 500000 };
  assert.equal((await A('POST', '/api/admin/products', { ...ok, price: 5 })).status, 400);
  assert.equal((await A('POST', '/api/admin/products', { ...ok, price: 'free' })).status, 400);
  assert.equal((await A('POST', '/api/admin/products', { ...ok, oldPrice: 400000 })).status, 400, 'old price must be higher');
  assert.equal((await A('POST', '/api/admin/products', { ...ok, category: 'dogs' })).status, 400);
  assert.equal((await A('POST', '/api/admin/products', { ...ok, artStyle: 'rocket' })).status, 400);
  assert.equal((await A('POST', '/api/admin/products', { ...ok, imageUrl: 'http://example.com/a.jpg' })).status, 400, 'https only');
  assert.equal((await A('POST', '/api/admin/products', { ...ok, imageUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await A('POST', '/api/admin/products', { ...ok, variants: [{ size: 99, colorName: 'x', colorHex: '#000000', stock: 1 }] })).status, 400);
  assert.equal((await A('POST', '/api/admin/products', { ...ok, variants: [{ size: 40, colorName: 'x', colorHex: 'red', stock: 1 }] })).status, 400);
  const dup = { size: 40, colorName: 'Red', colorHex: '#ff0000', stock: 1 };
  assert.equal((await A('POST', '/api/admin/products', { ...ok, variants: [dup, dup] })).status, 409);
  assert.equal(await count('products', `name = 'Bad Test'`), 0, 'nothing half-created');
  assert.ok((await A('POST', '/api/admin/products', { ...ok, imageUrl: 'https://example.com/shoe.jpg' })).status === 201);
});

test('hiding a shoe removes it from the shop; showing it brings it back', async () => {
  const p = await shoe(t, 'Pixel Low');
  const edit = (isActive) => A('PUT', `/api/admin/products/${p.id}`, productBody(p, { isActive }));
  assert.equal((await edit(false)).status, 200);
  assert.equal((await t.call('GET', `/api/products/${p.id}`)).status, 404);
  assert.ok(!(await t.call('GET', '/api/products?limit=100')).body.products.some((x) => x.id === p.id));
  assert.equal((await A('GET', `/api/admin/products/${p.id}`)).body.product.isActive, false, 'the admin still sees it');
  assert.equal((await edit(true)).status, 200);
  assert.equal((await t.call('GET', `/api/products/${p.id}`)).status, 200);
});

test('a price drop notifies people who saved the shoe; a price rise does not', async () => {
  const urban = await shoe(t, 'Urban Step');                    // Alex has it saved
  const before = (await notes(alex)).length;
  const up = await A('PUT', `/api/admin/products/${urban.id}`, productBody(urban, { price: 750000 }));
  assert.equal(up.status, 200);
  assert.equal((await notes(alex)).length, before, 'higher price: nobody is told');
  const down = await A('PUT', `/api/admin/products/${urban.id}`, productBody(urban, { price: 650000 }));
  assert.equal(down.status, 200);
  const n = (await notes(alex)).filter((x) => x.kind === 'price_drop' && x.productId === urban.id);
  assert.ok(n[0].body.includes('650 000'), n[0].body);
  assert.equal((await notes(aziza)).filter((x) => x.kind === 'price_drop' && x.productId === urban.id).length, 0, 'aziza did not save it');
  assert.equal((await t.call('GET', `/api/products/${urban.id}`)).body.product.price, 650000, 'customers see the new price at once');
});

test('restock: 0 -> more than 0 tells people with an alert or a heart, in their size when it matches', async () => {
  const urban = await shoe(t, 'Urban Step');
  const soldOut = urban.variants.find((v) => v.size === 42 && v.colorName === 'Black');
  assert.equal(soldOut.stock, 0);
  assert.equal((await t.call('PUT', `/api/products/${urban.id}/alert`, { token: aziza })).status, 200, 'aziza asks to be told');

  const lowStock = urban.variants.find((v) => v.stock > 0);
  const noEvent = await A('PUT', `/api/admin/variants/${lowStock.id}`, { stock: lowStock.stock + 1 });
  assert.equal(noEvent.body.notified, 0, 'changing 5 -> 6 is not a restock');

  const r = await A('PUT', `/api/admin/variants/${soldOut.id}`, { stock: 6 });
  assert.equal(r.status, 200);
  assert.equal(r.body.notified, 2);
  const mine = (await notes(alex)).find((n) => n.kind === 'restock' && n.body.includes('(42)'));
  assert.ok(mine, 'Alex wears 42, so the message names his size');
  const hers = (await notes(aziza)).find((n) => n.kind === 'restock' && n.productId === urban.id);
  assert.ok(hers && !hers.body.includes('your size'));
  assert.equal((await notes(bobur)).filter((n) => n.kind === 'restock').length, 0);
  assert.equal(await count('stock_alerts', 'product_id = $1', [urban.id]), 0, 'an alert is used up once it has fired');
  assert.equal((await t.call('GET', `/api/products/${urban.id}`)).body.product.variants.find((v) => v.id === soldOut.id).stock, 6);

  assert.equal((await A('PUT', `/api/admin/variants/${soldOut.id}`, { stock: -1 })).status, 400);
  assert.equal((await A('PUT', '/api/admin/variants/999999', { stock: 1 })).status, 404);
});

test('adding and removing a size', async () => {
  const p = await shoe(t, 'Summit Boot');
  const add = await A('POST', `/api/admin/products/${p.id}/variants`, { size: 42, colorName: 'Camel', colorHex: '#b88a56', stock: 3 });
  assert.equal(add.status, 201);
  assert.equal((await A('POST', `/api/admin/products/${p.id}/variants`, { size: 42, colorName: 'Camel', colorHex: '#b88a56', stock: 3 })).status, 409);
  assert.equal((await A('DELETE', `/api/admin/variants/${add.body.variant.id}`)).status, 200);
  assert.equal((await A('DELETE', `/api/admin/variants/${add.body.variant.id}`)).status, 404);
});

test('order life cycle: the customer sees every step and is told about it', async () => {
  const v = pick(await shoe(t, 'Kid Hero'));
  await t.call('POST', '/api/cart/items', { token: bobur, body: { variantId: v.id, qty: 1 } });
  const order = (await t.call('POST', '/api/checkout', { token: bobur, body: { address: ADDRESS, paymentMethod: 'cash' } })).body.order;

  const queue = (await A('GET', '/api/admin/orders?status=new')).body.orders;
  assert.ok(queue.some((o) => o.id === order.id && o.customer.email === 'bobur@demo.uz'));

  assert.equal((await A('PATCH', `/api/admin/orders/${order.id}/status`, { status: 'delivered' })).status, 409, 'cannot skip steps');
  assert.equal((await A('PATCH', `/api/admin/orders/${order.id}/status`, { status: 'teleported' })).status, 400);

  for (const status of ['processing', 'shipped', 'delivered']) {
    const r = await A('PATCH', `/api/admin/orders/${order.id}/status`, { status });
    assert.equal(r.status, 200);
    assert.equal((await t.call('GET', `/api/orders/${order.id}`, { token: bobur })).body.order.status, status);
  }
  const mine = await notes(bobur);
  assert.ok(mine.some((n) => n.body.includes('being packed')));
  assert.ok(mine.some((n) => n.body.includes('has shipped')));
  assert.ok(mine.some((n) => n.title === 'Order delivered' && n.orderId === order.id));
  const full = (await A('GET', `/api/admin/orders/${order.id}`)).body.order;
  assert.deepEqual(full.history.map((h) => h.status), ['new', 'processing', 'shipped', 'delivered']);
  assert.equal((await A('PATCH', `/api/admin/orders/${order.id}/status`, { status: 'cancelled' })).status, 409, 'delivered is final');

  // ...and now bobur may review the shoe
  assert.equal((await t.call('GET', `/api/products/${v.productId}`, { token: bobur })).body.product.canReview, true);
});

test('cancelling from the admin puts the stock back and tells the customer', async () => {
  const v = pick(await shoe(t, 'Velvet Slip'));
  const before = v.stock;
  await t.call('POST', '/api/cart/items', { token: aziza, body: { variantId: v.id, qty: 2 } });
  const order = (await t.call('POST', '/api/checkout', { token: aziza, body: { address: ADDRESS, paymentMethod: 'card' } })).body.order;
  assert.equal((await A('PATCH', `/api/admin/orders/${order.id}/status`, { status: 'cancelled' })).status, 200);
  const after = (await t.call('GET', `/api/products/${v.productId}`)).body.product.variants.find((x) => x.id === v.id);
  assert.equal(after.stock, before);
  assert.ok((await notes(aziza)).some((n) => n.body.includes('was cancelled')));
});

test('announcing a drop sends one notification to every customer and none to admins', async () => {
  const p = await shoe(t, 'Metro Hi');
  const r = await A('POST', '/api/admin/announce', { title: 'Winter drop', body: 'Metro Hi is back in new colours.', productId: p.id });
  assert.equal(r.status, 201);
  assert.ok(r.body.sent >= 3);
  for (const tok of [alex, aziza, bobur]) assert.ok((await notes(tok)).some((n) => n.kind === 'drop' && n.title === 'Winter drop' && n.productId === p.id));
  assert.equal((await t.call('GET', '/api/notifications', { token: admin })).body.notifications.length, 0);
  assert.equal((await A('POST', '/api/admin/announce', { body: 'x' })).status, 400);
  assert.equal((await A('POST', '/api/admin/announce', { body: 'Hello there', productId: 99999 })).status, 404);
});

test('coupons can be created, switched off and deleted', async () => {
  assert.equal((await A('POST', '/api/admin/coupons', { code: 'diwali20', percent: 20, minTotal: 100000 })).status, 201);
  assert.equal((await A('POST', '/api/admin/coupons', { code: 'DIWALI20', percent: 20 })).status, 409);
  assert.equal((await A('POST', '/api/admin/coupons', { code: 'x', percent: 20 })).status, 400);
  assert.equal((await A('POST', '/api/admin/coupons', { code: 'BIGONE', percent: 95 })).status, 400);
  const v = pick(await shoe(t, 'Swift Run'));
  await t.call('POST', '/api/cart/items', { token: alex, body: { variantId: v.id, qty: 1 } });
  const quote = (coupon) => t.call('POST', '/api/checkout/quote', { token: alex, body: { coupon } });
  assert.equal((await quote('DIWALI20')).body.discount, 128000);
  assert.equal((await A('PATCH', '/api/admin/coupons/diwali20', { active: false })).status, 200);
  assert.equal((await quote('DIWALI20')).status, 400);
  assert.equal((await A('DELETE', '/api/admin/coupons/DIWALI20')).status, 200);
  assert.equal((await A('DELETE', '/api/admin/coupons/DIWALI20')).status, 404);
  assert.ok((await A('GET', '/api/admin/coupons')).body.coupons.some((c) => c.code === 'WELCOME10'));
  await t.call('DELETE', '/api/cart', { token: alex });
});

test('customer list shows what each person spent and ignores cancelled orders', async () => {
  const c = (await A('GET', '/api/admin/customers')).body.customers;
  const alexRow = c.find((x) => x.email === 'alex@demo.uz');
  assert.equal(alexRow.orders, 2);
  assert.equal(alexRow.spent, 1200000);
  assert.ok(!c.some((x) => x.email === 'admin@shushop.uz'));
});

test('deleting a shoe removes it and its sizes but not the orders that mention it', async () => {
  const p = await shoe(t, 'Kid Hero');
  const orders0 = await count('orders');
  assert.equal((await A('DELETE', `/api/admin/products/${p.id}`)).status, 200);
  assert.equal((await t.call('GET', `/api/products/${p.id}`)).status, 404);
  assert.equal(await count('variants', 'product_id = $1', [p.id]), 0);
  assert.equal(await count('orders'), orders0);
  assert.equal((await A('DELETE', `/api/admin/products/${p.id}`)).status, 404);
});

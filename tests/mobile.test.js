import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, shoe, pick, ADDRESS } from './helpers.js';

let t, app, web, admin;     // "app" = Bearer token (Android), "web" = cookie (browser); both are Alex
before(async () => {
  t = await startApp();
  app = await t.login('alex@demo.uz');
  const r = await t.call('POST', '/api/login', { body: { email: 'alex@demo.uz', password: 'demo12345' } });
  web = r.cookies[0].split(';')[0];
  admin = await t.login('admin@shushop.uz', 'admin12345');
});
after(() => t.stop());

test('the phone sync needs a login', async () => {
  assert.equal((await t.call('GET', '/api/mobile/sync')).status, 401);
});

test('one sync call carries everything the phone stores offline', async () => {
  const s = (await t.call('GET', '/api/mobile/sync', { token: app })).body;
  assert.equal(s.user.email, 'alex@demo.uz');
  assert.equal(s.products.length, 16);
  assert.ok(s.products.every((p) => p.variants.length > 0 && p.variants.every((v) => v.productId === p.id)));
  assert.equal(s.products.filter((p) => p.isFavourite).length, 5);
  assert.equal(s.orders.length, 2);
  assert.ok(s.orders.every((o) => o.items.length === 1));
  assert.equal(s.notifications.length, 4);
  assert.equal(s.unreadCount, 2);
  assert.equal(s.cart.count, 0);
  assert.equal(s.addresses.length, 2);
  assert.equal(s.meta.shippingFee, 25000);
  assert.deepEqual(s.meta.paymentMethods, ['cash', 'card', 'payme', 'click']);
  assert.equal(s.stockAlertProductIds.length, 1);
  assert.ok(!JSON.stringify(s).includes('password'));
});

test('what you do in the browser shows up in the app, and the other way round', async () => {
  const v = pick(await shoe(t, 'Court Classic'));
  // browser adds to the cart -> the app's cart has it
  assert.equal((await t.call('POST', '/api/cart/items', { cookie: web, body: { variantId: v.id, qty: 2 } })).status, 201);
  assert.equal((await t.call('GET', '/api/mobile/sync', { token: app })).body.cart.count, 2);
  // app changes the quantity -> the browser sees it
  await t.call('PUT', `/api/cart/items/${v.id}`, { token: app, body: { qty: 1 } });
  assert.equal((await t.call('GET', '/api/cart', { cookie: web })).body.items[0].qty, 1);
  // app places the order -> it is in the browser's order list and in the admin's queue
  const placed = await t.call('POST', '/api/checkout', { token: app, body: { address: ADDRESS, paymentMethod: 'click' } });
  assert.equal(placed.status, 201);
  const id = placed.body.order.id;
  assert.ok((await t.call('GET', '/api/orders', { cookie: web })).body.orders.some((o) => o.id === id));
  assert.ok((await t.call('GET', '/api/admin/orders?status=new', { token: admin })).body.orders.some((o) => o.id === id));
  // admin ships it -> the phone's next sync shows the new status and a new notification
  await t.call('PATCH', `/api/admin/orders/${id}/status`, { token: admin, body: { status: 'processing' } });
  const s = (await t.call('GET', '/api/mobile/sync', { token: app })).body;
  assert.equal(s.orders.find((o) => o.id === id).status, 'processing');
  assert.ok(s.notifications.some((n) => n.orderId === id && n.body.includes('being packed')));
});

test('shoes the owner adds or hides reach the phone with the next sync', async () => {
  const add = await t.call('POST', '/api/admin/products', {
    token: admin, body: { name: 'Sync Test', brand: 'Kora', category: 'men', price: 450000, variants: [{ size: 41, colorName: 'Blue', colorHex: '#3d6fb4', stock: 2 }] },
  });
  assert.equal(add.status, 201);
  let s = (await t.call('GET', '/api/mobile/sync', { token: app })).body;
  assert.ok(s.products.some((p) => p.name === 'Sync Test' && p.variants[0].stock === 2));
  const p = add.body.product;
  await t.call('PUT', `/api/admin/products/${p.id}`, { token: admin, body: { name: p.name, brand: p.brand, type: p.type, category: p.category, price: p.price, isActive: false } });
  s = (await t.call('GET', '/api/mobile/sync', { token: app })).body;
  assert.ok(!s.products.some((x) => x.name === 'Sync Test'));
});

test('hearts: add, list, remove; the same call twice changes nothing', async () => {
  const p = await shoe(t, 'Night Runner');
  assert.equal((await t.call('PUT', `/api/favourites/${p.id}`, { token: app })).body.isFavourite, true);
  assert.equal((await t.call('PUT', `/api/favourites/${p.id}`, { token: app })).status, 200);
  let favs = (await t.call('GET', '/api/favourites', { cookie: web })).body.products;
  assert.equal(favs.length, 6);
  assert.ok(favs.every((f) => f.isFavourite));
  assert.equal((await t.call('DELETE', `/api/favourites/${p.id}`, { token: app })).body.isFavourite, false);
  favs = (await t.call('GET', '/api/favourites', { token: app })).body.products;
  assert.equal(favs.length, 5);
  assert.equal((await t.call('PUT', '/api/favourites/99999', { token: app })).status, 404);
});

test('back-in-stock alert can be switched on and off and shows on the shoe page', async () => {
  const p = await shoe(t, 'Aero Knit');
  assert.equal((await t.call('PUT', `/api/products/${p.id}/alert`, { token: app })).body.hasAlert, true);
  assert.equal((await t.call('GET', `/api/products/${p.id}`, { token: app })).body.product.hasAlert, true);
  assert.equal((await t.call('DELETE', `/api/products/${p.id}/alert`, { token: app })).body.hasAlert, false);
  assert.equal((await t.call('GET', `/api/products/${p.id}`, { token: app })).body.product.hasAlert, false);
});

test('notifications: unread count, mark one read, mark all read, not other peoples', async () => {
  let r = (await t.call('GET', '/api/notifications', { token: app })).body;
  assert.ok(r.unreadCount >= 2);
  const first = r.notifications.find((n) => !n.isRead);
  assert.equal((await t.call('POST', `/api/notifications/${first.id}/read`, { token: app })).status, 200);
  assert.equal((await t.call('GET', '/api/notifications', { token: app })).body.unreadCount, r.unreadCount - 1);
  const aziza = await t.login('aziza@demo.uz');
  assert.equal((await t.call('POST', `/api/notifications/${first.id}/read`, { token: aziza })).status, 404);
  assert.equal((await t.call('POST', '/api/notifications/read-all', { token: app })).status, 200);
  r = (await t.call('GET', '/api/notifications', { token: app })).body;
  assert.equal(r.unreadCount, 0);
  assert.ok(r.notifications.every((n) => n.isRead));
  assert.equal((await t.call('GET', '/api/summary', { token: app })).body.unreadCount, 0);
});

test('the header summary counts the cart, hearts and orders on the way', async () => {
  await t.call('DELETE', '/api/cart', { token: app });
  const v = pick(await shoe(t, 'Swift Run'));
  await t.call('POST', '/api/cart/items', { token: app, body: { variantId: v.id, qty: 3 } });
  const s = (await t.call('GET', '/api/summary', { token: app })).body;
  assert.equal(s.cartCount, 3);
  assert.equal(s.favouriteCount, 5);
  assert.ok(s.activeOrders >= 1);
});

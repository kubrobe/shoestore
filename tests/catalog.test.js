import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, pool, shoe } from './helpers.js';
import { SHIPPING_FEE, FREE_SHIPPING_FROM, MAX_QTY } from '../src/rules.js';

let t;
before(async () => { t = await startApp(); });
after(() => t.stop());

const list = async (qs = '', token) => (await t.call('GET', `/api/products${qs}`, { token })).body;

test('the shop lists every active shoe with everything a card needs', async () => {
  const r = await list();
  assert.equal(r.total, 16);
  assert.equal(r.products.length, 16);
  const p = r.products.find((x) => x.name === 'Urban Step');
  assert.equal(p.brand, 'Nomad');
  assert.equal(p.price, 720000);
  assert.equal(p.oldPrice, 890000);
  assert.equal(p.onSale, true);
  assert.equal(p.discountPercent, 19);
  assert.ok(p.colors.length >= 2 && p.colors[0].hex.startsWith('#'));
  assert.ok(p.sizesInStock.length > 0);
  assert.equal(typeof p.avgRating, 'number');
  assert.equal(p.isFavourite, false, 'a visitor has no favourites');
});

test('search looks at the name, the brand and the type, and treats % and _ as plain text', async () => {
  assert.deepEqual((await list('?search=nomad')).products.map((p) => p.brand), ['Nomad', 'Nomad', 'Nomad', 'Nomad']);
  assert.equal((await list('?search=cloud')).products[0].name, 'Cloud Walker');
  assert.ok((await list('?search=boots')).products.every((p) => p.type === 'Boots'));
  assert.equal((await list('?search=%25')).total, 0, 'a lone % must not match everything');
  assert.equal((await list('?search=_')).total, 0);
  assert.equal((await list('?search=zzzz')).total, 0);
});

test('category chips: men and women include unisex shoes, kids and sale are exact', async () => {
  const men = (await list('?category=men')).products;
  assert.ok(men.length > 0 && men.every((p) => ['men', 'unisex'].includes(p.category)));
  const women = (await list('?category=women')).products;
  assert.ok(women.every((p) => ['women', 'unisex'].includes(p.category)));
  assert.ok(women.some((p) => p.name === 'Cloud Walker') && !women.some((p) => p.name === 'Swift Run'));
  const kids = (await list('?category=kids')).products;
  assert.deepEqual(kids.map((p) => p.name).sort(), ['Kid Hero', 'Little Spark']);
  const sale = (await list('?category=sale')).products;
  assert.ok(sale.length >= 3 && sale.every((p) => p.onSale));
});

test('size filter only returns shoes that can really be bought in that size', async () => {
  const r = await list('?size=30');
  assert.deepEqual(r.products.map((p) => p.name).sort(), ['Kid Hero', 'Little Spark']);
  assert.ok(r.products.every((p) => p.sizesInStock.includes(30)));
  assert.equal((await list('?size=50')).total, 0);
  assert.equal((await t.call('GET', '/api/products?size=abc')).status, 400);
});

test('price range, brand filter and sorting work together', async () => {
  const r = await list('?min=500000&max=700000&sort=price_asc');
  const prices = r.products.map((p) => p.price);
  assert.ok(prices.length > 3 && prices.every((x) => x >= 500000 && x <= 700000));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const desc = (await list('?sort=price_desc')).products.map((p) => p.price);
  assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
  assert.ok((await list('?brand=kora')).products.every((p) => p.brand === 'Kora'));
  const rated = (await list('?sort=rating')).products.map((p) => p.avgRating);
  assert.deepEqual(rated, [...rated].sort((a, b) => b - a));
});

test('pagination keeps the full total', async () => {
  const page = await list('?limit=5&offset=10');
  assert.equal(page.products.length, 5);
  assert.equal(page.total, 16);
  assert.equal((await list('?limit=5&offset=15')).products.length, 1);
  assert.equal((await t.call('GET', '/api/products?limit=0')).status, 400);
  assert.equal((await t.call('GET', '/api/products?limit=1000')).status, 400);
});

test('hearts show up on the cards of a logged-in user', async () => {
  const alex = await t.login('alex@demo.uz');
  const hearts = (await list('?limit=100', alex)).products.filter((p) => p.isFavourite).map((p) => p.name).sort();
  assert.deepEqual(hearts, ['AirFlex Sneakers', 'Cloud Walker', 'Metro Hi', 'Swift Run', 'Urban Step']);
});

test('shoe page has sizes, colours, reviews and a rating breakdown that adds up', async () => {
  const d = await shoe(t, 'Cloud Walker');
  assert.ok(d.variants.length > 10);
  assert.ok(d.variants.every((v) => v.stock >= 0 && /^#[0-9a-f]{6}$/.test(v.colorHex)));
  assert.equal(Object.values(d.ratingBreakdown).reduce((a, b) => a + b, 0), d.reviewCount);
  assert.equal(d.reviews.length, d.reviewCount);
  assert.ok(d.reviews[0].author.length > 0 && !('email' in d.reviews[0]));
  assert.equal(d.canReview, false);
  assert.equal(d.hasAlert, false);
});

test('unknown, malformed and hidden shoes give clean errors', async () => {
  assert.equal((await t.call('GET', '/api/products/99999')).status, 404);
  assert.equal((await t.call('GET', '/api/products/abc')).status, 400);
  assert.equal((await t.call('GET', '/api/products/-3')).status, 400);
  await pool.query(`UPDATE products SET is_active = false WHERE name = 'Pixel Low'`);
  assert.equal((await list()).total, 15);
  const id = (await pool.query(`SELECT id FROM products WHERE name = 'Pixel Low'`)).rows[0].id;
  assert.equal((await t.call('GET', `/api/products/${id}`)).status, 404);
  await pool.query(`UPDATE products SET is_active = true WHERE name = 'Pixel Low'`);
});

test('generated shoe pictures are SVG, follow the colour and cannot be used to inject markup', async () => {
  const d = await shoe(t, 'Swift Run');
  const ok = await t.call('GET', `/img/shoe/${d.id}.svg?c=%23ff0000`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/svg\+xml/);
  assert.ok(ok.text.startsWith('<svg') && ok.text.includes('#ff0000'));
  const evil = await t.call('GET', `/img/shoe/${d.id}.svg?c=${encodeURIComponent('"><script>alert(1)</script>')}`);
  assert.equal(evil.status, 200);
  assert.equal(evil.text.includes('<script'), false);
  const free = await t.call('GET', '/img/shoe.svg?style=boot&c=%23123456');
  assert.equal(free.status, 200);
  assert.equal((await t.call('GET', '/img/shoe/99999.svg')).status, 404);
});

test('shop rules are served from one place', async () => {
  const m = (await t.call('GET', '/api/meta')).body;
  assert.equal(m.shippingFee, SHIPPING_FEE);
  assert.equal(m.freeShippingFrom, FREE_SHIPPING_FROM);
  assert.equal(m.maxQtyPerItem, MAX_QTY);
  assert.deepEqual(m.paymentMethods, ['cash', 'card', 'payme', 'click']);
  assert.ok(m.brands.includes('Kora') && m.sizeRange.min <= 28 && m.sizeRange.max >= 46);
  assert.equal((await t.call('GET', '/api/health')).body.ok, true);
});

test('only a delivered order lets you review, one review per shoe, and the average follows', async () => {
  const alex = await t.login('alex@demo.uz');
  const swift = await shoe(t, 'Swift Run');      // Alex's order with it is only "shipped"
  assert.equal((await t.call('POST', `/api/products/${swift.id}/reviews`, { token: alex, body: { rating: 5, comment: 'Great' } })).status, 403);
  assert.equal(swift.canReview, false);

  const court = await shoe(t, 'Court Classic');  // Alex's order with it is delivered
  const as = (await t.call('GET', `/api/products/${court.id}`, { token: alex })).body.product;
  assert.equal(as.canReview, true);
  const before = as.reviewCount;
  const first = await t.call('POST', `/api/products/${court.id}/reviews`, { token: alex, body: { rating: 1, comment: 'Too tight for me' } });
  assert.equal(first.status, 201);
  const again = await t.call('POST', `/api/products/${court.id}/reviews`, { token: alex, body: { rating: 4, comment: 'Better after a week' } });
  assert.equal(again.status, 201);
  assert.ok(again.body.reviewCount <= before + 1, 'a second review replaces the first, it does not add one');
  const after = (await t.call('GET', `/api/products/${court.id}`, { token: alex })).body.product;
  assert.equal(after.reviews[0].mine, true);
  assert.equal(after.reviews[0].comment, 'Better after a week');

  assert.equal((await t.call('POST', `/api/products/${court.id}/reviews`, { token: alex, body: { rating: 6 } })).status, 400);
  assert.equal((await t.call('POST', `/api/products/${court.id}/reviews`, { token: alex, body: { rating: 0 } })).status, 400);
  assert.equal((await t.call('POST', `/api/products/${court.id}/reviews`, { token: alex, body: { rating: 5, comment: 'x'.repeat(501) } })).status, 400);
});

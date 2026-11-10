// The public shop: list with search / filters / sort, one shoe in detail, reviews, generated shoe pictures,
// shop rules (meta) and the health check Render uses.
import { query } from './db.js';
import { requireAuth } from './auth.js';
import { HttpError, cleanId, cleanInt, cleanText, likeEscape } from './validate.js';
import { cardColumns, CARD_FROM, productCard, variantJson } from './shape.js';
import { shoeSvg, accentFor, STYLES } from './shoe-art.js';
import { SHIPPING_FEE, FREE_SHIPPING_FROM, MAX_QTY, PAYMENT_METHODS, ORDER_STATUSES } from './rules.js';

export const CATEGORIES = ['men', 'women', 'kids', 'sale'];

const SORTS = {
  popular: `(SELECT COALESCE(SUM(oi.qty), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = p.id AND o.status <> 'cancelled') DESC, p.id ASC`,
  price_asc: 'p.price ASC, p.id ASC',
  price_desc: 'p.price DESC, p.id ASC',
  newest: 'p.created_at DESC, p.id DESC',
  rating: 'COALESCE(pr.avg_rating, 0) DESC, COALESCE(pr.review_count, 0) DESC, p.id ASC',
};

export async function loadMeta() {
  const brands = await query('SELECT name FROM brands ORDER BY name');
  const sizes = await query('SELECT min(size) AS lo, max(size) AS hi FROM variants');
  return {
    currency: "so'm",
    shippingFee: SHIPPING_FEE,
    freeShippingFrom: FREE_SHIPPING_FROM,
    maxQtyPerItem: MAX_QTY,
    paymentMethods: PAYMENT_METHODS,
    orderStatuses: ORDER_STATUSES,
    categories: CATEGORIES,
    sorts: Object.keys(SORTS),
    artStyles: STYLES,
    brands: brands.rows.map((b) => b.name),
    sizeRange: { min: sizes.rows[0].lo ?? 36, max: sizes.rows[0].hi ?? 46 },
  };
}

// Shared by the shop list and by the phone sync: builds and runs the list query.
export async function listProducts({ userId = 0, search, category, brand, size, min, max, sort = 'popular', limit = 40, offset = 0 }) {
  const params = [userId];
  const where = ['p.is_active'];
  const add = (v) => { params.push(v); return `$${params.length}`; };

  if (search) {
    const p = add(`%${likeEscape(search)}%`);
    where.push(`(p.name ILIKE ${p} ESCAPE '\\' OR b.name ILIKE ${p} ESCAPE '\\' OR p.type ILIKE ${p} ESCAPE '\\')`);
  }
  if (category === 'men') where.push(`p.category IN ('men', 'unisex')`);
  else if (category === 'women') where.push(`p.category IN ('women', 'unisex')`);
  else if (category === 'kids') where.push(`p.category = 'kids'`);
  else if (category === 'sale') where.push('p.old_price IS NOT NULL');
  if (brand) where.push(`lower(b.name) = lower(${add(String(brand).slice(0, 40))})`);
  if (size) where.push(`EXISTS (SELECT 1 FROM variants v WHERE v.product_id = p.id AND v.size = ${add(size)} AND v.stock > 0)`);
  if (min != null) where.push(`p.price >= ${add(min)}`);
  if (max != null) where.push(`p.price <= ${add(max)}`);

  const lim = add(limit);
  const off = add(offset);
  const r = await query(
    `SELECT ${cardColumns('$1')}, COUNT(*) OVER() AS total_count
       ${CARD_FROM}
      WHERE ${where.join(' AND ')}
      ORDER BY ${SORTS[sort] || SORTS.popular}
      LIMIT ${lim} OFFSET ${off}`, params);
  return { products: r.rows.map(productCard), total: r.rows[0] ? Number(r.rows[0].total_count) : 0 };
}

function parseListQuery(q) {
  const out = { sort: SORTS[q.sort] ? q.sort : 'popular' };
  if (typeof q.search === 'string' && q.search.trim()) out.search = q.search;
  if (CATEGORIES.includes(q.category)) out.category = q.category;
  if (typeof q.brand === 'string' && q.brand.trim()) out.brand = q.brand;
  if (q.size !== undefined && q.size !== '') out.size = cleanInt(q.size, { min: 16, max: 50, field: 'size' });
  if (q.min !== undefined && q.min !== '') out.min = cleanInt(q.min, { min: 0, max: 100_000_000, field: 'min' });
  if (q.max !== undefined && q.max !== '') out.max = cleanInt(q.max, { min: 0, max: 100_000_000, field: 'max' });
  out.limit = q.limit !== undefined ? cleanInt(q.limit, { min: 1, max: 100, field: 'limit' }) : 40;
  out.offset = q.offset !== undefined ? cleanInt(q.offset, { min: 0, max: 100_000, field: 'offset' }) : 0;
  return out;
}

const REVIEWER = `split_part(u.full_name, ' ', 1) || COALESCE(' ' || NULLIF(left(split_part(u.full_name, ' ', 2), 1), '') || '.', '')`;

export function catalogRoutes(app) {
  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.get('/api/meta', async (_req, res) => res.json(await loadMeta()));

  app.get('/api/products', async (req, res) => {
    const filters = parseListQuery(req.query);
    const { products, total } = await listProducts({ ...filters, userId: req.user?.id ?? 0 });
    res.json({ products, total, limit: filters.limit, offset: filters.offset });
  });

  app.get('/api/products/:id', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const uid = req.user?.id ?? 0;
    const p = await query(
      `SELECT ${cardColumns('$2')},
              EXISTS (SELECT 1 FROM stock_alerts a WHERE a.user_id = $2 AND a.product_id = p.id) AS has_alert
         ${CARD_FROM} WHERE p.id = $1 AND p.is_active`, [id, uid]);
    if (!p.rows[0]) throw new HttpError(404, 'Shoe not found');

    const [variants, reviews, stars, bought] = await Promise.all([
      query('SELECT id, product_id, size, color_name, color_hex, stock FROM variants WHERE product_id = $1 ORDER BY color_name, size', [id]),
      query(`SELECT r.id, r.rating, r.comment, r.created_at, ${REVIEWER} AS author, (r.user_id = $2) AS mine
               FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = $1
              ORDER BY (r.user_id = $2) DESC, r.created_at DESC LIMIT 20`, [id, uid]),
      query('SELECT rating, count(*)::int AS n FROM reviews WHERE product_id = $1 GROUP BY rating', [id]),
      query(`SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE oi.product_id = $1 AND o.user_id = $2 AND o.status = 'delivered' LIMIT 1`, [id, uid]),
    ]);
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const s of stars.rows) breakdown[s.rating] = s.n;
    res.json({
      product: {
        ...productCard(p.rows[0]),
        hasAlert: !!p.rows[0].has_alert,
        variants: variants.rows.map(variantJson),
        canReview: !!req.user && bought.rows.length > 0,
        ratingBreakdown: breakdown,
        reviews: reviews.rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, author: r.author, mine: r.mine, createdAt: r.created_at })),
      },
    });
  });

  // One review per person per shoe, and only after an order with that shoe was delivered.
  app.post('/api/products/:id/reviews', requireAuth, async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const rating = cleanInt(req.body.rating, { min: 1, max: 5, field: 'Rating' });
    const comment = cleanText(req.body.comment ?? '', { max: 500, field: 'Comment' });
    const bought = await query(
      `SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = $1 AND o.user_id = $2 AND o.status = 'delivered' LIMIT 1`, [id, req.user.id]);
    if (!bought.rows[0]) throw new HttpError(403, 'You can review a shoe after your order with it has been delivered');
    await query(
      `INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()`,
      [id, req.user.id, rating, comment]);
    const r = await query('SELECT avg_rating, review_count FROM product_ratings WHERE product_id = $1', [id]);
    res.status(201).json({ avgRating: Number(r.rows[0].avg_rating), reviewCount: r.rows[0].review_count });
  });

  // ---------- generated shoe pictures (colour = the selected variant, so the picture changes with the colour dot)
  const svgHeaders = (res) => res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  const hexOrNull = (c) => (typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c) ? (c.startsWith('#') ? c : `#${c}`) : null);

  app.get('/img/shoe/:id.svg', async (req, res) => {
    const id = cleanId(req.params.id, 'id');
    const r = await query(
      `SELECT p.art_style, (SELECT color_hex FROM variants WHERE product_id = p.id ORDER BY id LIMIT 1) AS first_color
         FROM products p WHERE p.id = $1`, [id]);
    if (!r.rows[0]) throw new HttpError(404, 'Shoe not found');
    svgHeaders(res).send(shoeSvg({
      style: r.rows[0].art_style, color: hexOrNull(req.query.c) || r.rows[0].first_color || '#cdbfaa', accent: accentFor(id),
    }));
  });

  app.get('/img/shoe.svg', (req, res) => {
    svgHeaders(res).send(shoeSvg({ style: String(req.query.style || 'court'), color: hexOrNull(req.query.c) || '#cdbfaa', accent: hexOrNull(req.query.a) || '#f26a3d' }));
  });
}

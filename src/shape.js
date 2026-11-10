// How a shoe looks in JSON. The shop list, favourites, product page, admin list and the phone sync all use these
// pieces, so a shoe has exactly the same fields everywhere (and the Android app only needs one parser).

// Columns for one "shoe card". Needs: FROM products p JOIN brands b ... LEFT JOIN product_ratings pr ...
// `userParam` is the placeholder (like "$1") holding the logged-in user id; use 0 for visitors (no user has id 0).
export const cardColumns = (userParam) => `
  p.id, p.name, b.name AS brand, p.type, p.category, p.description, p.price, p.old_price, p.art_style, p.image_url,
  p.is_active, p.created_at,
  COALESCE(pr.avg_rating, 0) AS avg_rating, COALESCE(pr.review_count, 0) AS review_count,
  COALESCE((SELECT SUM(v.stock) FROM variants v WHERE v.product_id = p.id), 0) AS total_stock,
  COALESCE((SELECT json_agg(json_build_object('name', c.color_name, 'hex', c.color_hex) ORDER BY c.color_name)
              FROM (SELECT DISTINCT color_name, color_hex FROM variants WHERE product_id = p.id) c), '[]'::json) AS colors,
  COALESCE((SELECT array_agg(DISTINCT v.size ORDER BY v.size) FROM variants v WHERE v.product_id = p.id AND v.stock > 0), '{}') AS sizes_in_stock,
  EXISTS (SELECT 1 FROM favourites f WHERE f.user_id = ${userParam} AND f.product_id = p.id) AS is_favourite`;

export const CARD_FROM = `FROM products p JOIN brands b ON b.id = p.brand_id LEFT JOIN product_ratings pr ON pr.product_id = p.id`;

export function productCard(r) {
  const onSale = r.old_price != null && r.old_price > r.price;
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    type: r.type,
    category: r.category,
    description: r.description,
    price: r.price,
    oldPrice: r.old_price ?? null,
    onSale,
    discountPercent: onSale ? Math.round(((r.old_price - r.price) * 100) / r.old_price) : 0,
    artStyle: r.art_style,
    imageUrl: r.image_url || null,
    isActive: r.is_active,
    colors: r.colors,                                  // [{name, hex}]
    sizesInStock: r.sizes_in_stock,                    // [38, 39, ...] sizes that can be bought right now
    inStock: Number(r.total_stock) > 0,
    avgRating: Number(r.avg_rating),
    reviewCount: Number(r.review_count),
    isFavourite: !!r.is_favourite,
    createdAt: r.created_at,
  };
}

export const variantJson = (v) => ({ id: v.id, productId: v.product_id, size: v.size, colorName: v.color_name, colorHex: v.color_hex, stock: v.stock });

export const orderItemJson = (i) => ({
  id: i.id, productId: i.product_id, variantId: i.variant_id, name: i.product_name, brand: i.brand_name,
  size: i.size, colorName: i.color_name, colorHex: i.color_hex, artStyle: i.art_style, unitPrice: i.unit_price, qty: i.qty,
});

export const orderJson = (o, items = [], log = null) => ({
  id: o.id, status: o.status, subtotal: o.subtotal, shippingFee: o.shipping_fee, discount: o.discount, total: o.total,
  couponCode: o.coupon_code || null, addressLine: o.address_line, city: o.city, phone: o.phone, paymentMethod: o.payment_method,
  createdAt: o.created_at, updatedAt: o.updated_at, items: items.map(orderItemJson),
  itemCount: items.reduce((n, i) => n + i.qty, 0),
  ...(log ? { history: log.map((l) => ({ status: l.status, at: l.created_at })) } : {}),
});

export const notificationJson = (n) => ({
  id: n.id, kind: n.kind, title: n.title, body: n.body, productId: n.product_id, orderId: n.order_id, isRead: n.is_read, createdAt: n.created_at,
});

export const addressJson = (a) => ({ id: a.id, label: a.label, line: a.line, city: a.city, phone: a.phone, isDefault: a.is_default });

-- Shushop demo data. All people, brands and shoes are FICTIONAL.
-- Demo accounts:  alex@demo.uz / aziza@demo.uz / bobur@demo.uz  password  demo12345
--                 admin@shushop.uz                                password  admin12345   (CHANGE IT after you deploy, see README)
-- Runs only when the database is still empty (so running it twice changes nothing).

DO $seed$
BEGIN
IF EXISTS (SELECT 1 FROM brands) THEN
  RETURN;
END IF;

-- ------------------------------------------------------------ brands and shoes
INSERT INTO brands (name) VALUES ('Kora'), ('Velo'), ('Nomad'), ('Atlas'), ('Lume');

INSERT INTO products (brand_id, name, type, category, description, price, old_price, art_style)
SELECT b.id, d.name, d.type, d.category, d.description, d.price, d.old_price, d.art_style
FROM (SELECT v.*, row_number() OVER () AS n FROM (VALUES
  ('Kora',  'AirFlex Sneakers', 'Sneakers', 'unisex', 'Lightweight, breathable, and designed for all-day comfort. Step into your style with the perfect blend of performance and design.',  690000, NULL::bigint, 'court'),
  ('Velo',  'Swift Run',        'Sports',   'men',    'Responsive foam and a breathable knit upper for daily runs and gym sessions.',                                                      640000, NULL, 'runner'),
  ('Nomad', 'Urban Step',       'Sneakers', 'men',    'A high-top street classic with a padded collar and a grippy rubber outsole.',                                                       720000, 890000, 'high'),
  ('Kora',  'Cloud Walker',     'Casual',   'women',  'A cushioned platform sole that feels like walking on a cloud, all day long.',                                                       580000, NULL, 'chunky'),
  ('Nomad', 'Street Pulse',     'Sneakers', 'men',    'Bold chunky silhouette with a durable leather upper and a layered sole.',                                                           810000, NULL, 'chunky'),
  ('Atlas', 'Trail Master',     'Boots',    'men',    'Waterproof leather boot with a lugged sole for cold, wet and muddy days.',                                                          960000, NULL, 'boot'),
  ('Kora',  'Little Spark',     'Kids',     'kids',   'Easy-on straps and a flexible sole for little feet that never stop moving.',                                                        330000, NULL, 'runner'),
  ('Lume',  'Velvet Slip',      'Casual',   'women',  'Soft slip-on with a cushioned insole. No laces, no fuss.',                                                                          450000, 540000, 'slip'),
  ('Velo',  'Court Classic',    'Sneakers', 'unisex', 'The clean everyday court shoe. Goes with jeans, shorts and everything else.',                                                       560000, NULL, 'court'),
  ('Velo',  'Night Runner',     'Sports',   'women',  'Reflective details and a cushioned heel for evening runs.',                                                                         690000, NULL, 'runner'),
  ('Nomad', 'Metro Hi',         'Sneakers', 'unisex', 'Premium suede high-top, built for the city.',                                                                                       780000, NULL, 'high'),
  ('Kora',  'Aero Knit',        'Sports',   'men',    'Seamless knit upper that hugs the foot, with a springy midsole.',                                                                   740000, 890000, 'runner'),
  ('Atlas', 'Heritage Loafer',  'Casual',   'men',    'Hand-finished leather loafer for office days and weekend dinners.',                                                                 880000, NULL, 'slip'),
  ('Lume',  'Kid Hero',         'Kids',     'kids',   'Hard-wearing high-top for school and playground adventures.',                                                                       290000, NULL, 'high'),
  ('Atlas', 'Summit Boot',      'Boots',    'women',  'Insulated leather boot with a soft lining and a non-slip sole.',                                                                    1090000, NULL, 'boot'),
  ('Nomad', 'Pixel Low',        'Sneakers', 'unisex', 'Minimal low-top with a retro profile and a soft canvas lining.',                                                                    510000, 590000, 'court')
) AS v(brand, name, type, category, description, price, old_price, art_style)) AS d
JOIN brands b ON b.name = d.brand
ORDER BY d.n;          -- ids follow the order of this list, so the demo always looks the same

-- ------------------------------------------------------------ sizes x colours (stock is a repeatable "random" 2..10)
INSERT INTO variants (product_id, size, color_name, color_hex, stock)
SELECT p.id, s.size, c.color_name, c.color_hex,
       CASE WHEN abs(hashtext(p.name || c.color_name || s.size::text)) % 13 = 0 THEN 0
            ELSE 2 + abs(hashtext(c.color_name || p.name || s.size::text)) % 9 END
FROM (VALUES
  ('AirFlex Sneakers', 38, 45, 'Beige',  '#cdbfaa'), ('AirFlex Sneakers', 38, 45, 'Brown',  '#7b5a3c'), ('AirFlex Sneakers', 38, 45, 'Black',  '#1b1b1d'),
  ('Swift Run',        39, 46, 'Cloud',  '#e6e6e8'), ('Swift Run',        39, 46, 'Ink',    '#272a31'), ('Swift Run',        39, 46, 'Orange', '#f26a3d'),
  ('Urban Step',       39, 46, 'Black',  '#1c1c1e'), ('Urban Step',       39, 46, 'Stone',  '#d8d4cc'),
  ('Cloud Walker',     35, 41, 'Cream',  '#efe6d8'), ('Cloud Walker',     35, 41, 'Blush',  '#e8c4c0'), ('Cloud Walker',     35, 41, 'Sage',   '#b5c4a8'),
  ('Street Pulse',     40, 46, 'Black',  '#232326'), ('Street Pulse',     40, 46, 'Sand',   '#c9b79c'),
  ('Trail Master',     40, 46, 'Brown',  '#6b4a2f'), ('Trail Master',     40, 46, 'Black',  '#222222'),
  ('Little Spark',     28, 35, 'Blue',   '#4a7bd6'), ('Little Spark',     28, 35, 'Pink',   '#f08ab5'),
  ('Velvet Slip',      35, 41, 'Navy',   '#2b3a67'), ('Velvet Slip',      35, 41, 'Rose',   '#d99aa8'),
  ('Court Classic',    36, 46, 'White',  '#f4f4f2'), ('Court Classic',    36, 46, 'Navy',   '#26334f'),
  ('Night Runner',     35, 41, 'Black',  '#1d1d20'), ('Night Runner',     35, 41, 'Pink',   '#e48fb0'),
  ('Metro Hi',         38, 46, 'Olive',  '#6f7552'), ('Metro Hi',         38, 46, 'Sand',   '#d2c2a5'),
  ('Aero Knit',        39, 46, 'Grey',   '#9aa0a8'), ('Aero Knit',        39, 46, 'Blue',   '#3d6fb4'),
  ('Heritage Loafer',  40, 46, 'Tan',    '#a8754a'), ('Heritage Loafer',  40, 46, 'Black',  '#1f1f21'),
  ('Kid Hero',         27, 34, 'Red',    '#cf3b3b'), ('Kid Hero',         27, 34, 'Black',  '#1f1f21'),
  ('Summit Boot',      35, 41, 'Camel',  '#b88a56'), ('Summit Boot',      35, 41, 'Black',  '#202022'),
  ('Pixel Low',        36, 45, 'Ecru',   '#e7dfcf'), ('Pixel Low',        36, 45, 'Green',  '#4f7a5a')
) AS c(pname, min_size, max_size, color_name, color_hex)
JOIN products p ON p.name = c.pname
CROSS JOIN LATERAL generate_series(c.min_size, c.max_size) AS s(size);

-- One sold-out pair, so the "back in stock" alert can be shown live from the admin page
UPDATE variants SET stock = 0
 WHERE size = 42 AND color_name = 'Black' AND product_id = (SELECT id FROM products WHERE name = 'Urban Step');
-- ...and a pair with only 1 left (low-stock list in the admin dashboard)
UPDATE variants SET stock = 1
 WHERE size = 42 AND color_name = 'Stone' AND product_id = (SELECT id FROM products WHERE name = 'Urban Step');

-- ------------------------------------------------------------ people
INSERT INTO users (email, password_hash, full_name, phone, role, shoe_size_eu, created_at) VALUES
  ('admin@shushop.uz', '$2b$10$UUGT8OV9cQ9vfSoKOcbeo.Ac.7ijjX9wtwtIYyF9R2QVU6wztQsHO', 'Shushop Admin',  '+998 90 000 00 00', 'admin',    NULL, now() - interval '400 days'),
  ('alex@demo.uz',     '$2b$10$EgOGZpKErK8j0GM2n5nsge4fgbBsqjPekj.xXW5rYn0LnmKNbLIWa', 'Alex Morgan',    '+998 90 123 45 67', 'customer', 42,   now() - interval '690 days'),
  ('aziza@demo.uz',    '$2b$10$EgOGZpKErK8j0GM2n5nsge4fgbBsqjPekj.xXW5rYn0LnmKNbLIWa', 'Aziza Karimova', '+998 91 222 33 44', 'customer', 38,   now() - interval '200 days'),
  ('bobur@demo.uz',    '$2b$10$EgOGZpKErK8j0GM2n5nsge4fgbBsqjPekj.xXW5rYn0LnmKNbLIWa', 'Bobur Rakhimov', '+998 93 555 66 77', 'customer', 43,   now() - interval '90 days');

INSERT INTO addresses (user_id, label, line, city, phone, is_default)
SELECT u.id, a.label, a.line, a.city, a.phone, a.is_default
FROM (VALUES
  ('alex@demo.uz',  'Home', 'Chilonzor 9, apt 12',  'Tashkent',  '+998 90 123 45 67', true),
  ('alex@demo.uz',  'Work', 'Amir Temur 15, floor 3', 'Tashkent', '+998 90 123 45 67', false),
  ('aziza@demo.uz', 'Home', 'Mirzo Ulugbek 41, apt 7', 'Tashkent', '+998 91 222 33 44', true)
) AS a(email, label, line, city, phone, is_default)
JOIN users u ON u.email = a.email;

-- ------------------------------------------------------------ coupons
INSERT INTO coupons (code, percent, min_total) VALUES ('WELCOME10', 10, 0), ('SNEAKER15', 15, 600000);

-- ------------------------------------------------------------ orders (price copied into the items)
-- Alex 1: delivered 35 days ago
WITH o AS (
  INSERT INTO orders (user_id, status, subtotal, shipping_fee, discount, total, address_line, city, phone, payment_method, created_at, updated_at)
  SELECT id, 'delivered', 560000, 0, 0, 560000, 'Chilonzor 9, apt 12', 'Tashkent', '+998 90 123 45 67', 'payme', now() - interval '35 days', now() - interval '31 days'
    FROM users WHERE email = 'alex@demo.uz' RETURNING id)
INSERT INTO order_items (order_id, variant_id, product_id, product_name, brand_name, size, color_name, color_hex, art_style, unit_price, qty)
SELECT o.id, v.id, p.id, p.name, b.name, v.size, v.color_name, v.color_hex, p.art_style, p.price, 1
  FROM o, variants v JOIN products p ON p.id = v.product_id JOIN brands b ON b.id = p.brand_id
 WHERE p.name = 'Court Classic' AND v.size = 42 AND v.color_name = 'White';

-- Alex 2: shipped two days ago ("1 on the way")
WITH o AS (
  INSERT INTO orders (user_id, status, subtotal, shipping_fee, discount, total, address_line, city, phone, payment_method, created_at, updated_at)
  SELECT id, 'shipped', 640000, 0, 0, 640000, 'Chilonzor 9, apt 12', 'Tashkent', '+998 90 123 45 67', 'click', now() - interval '2 days', now() - interval '18 minutes'
    FROM users WHERE email = 'alex@demo.uz' RETURNING id)
INSERT INTO order_items (order_id, variant_id, product_id, product_name, brand_name, size, color_name, color_hex, art_style, unit_price, qty)
SELECT o.id, v.id, p.id, p.name, b.name, v.size, v.color_name, v.color_hex, p.art_style, p.price, 1
  FROM o, variants v JOIN products p ON p.id = v.product_id JOIN brands b ON b.id = p.brand_id
 WHERE p.name = 'Swift Run' AND v.size = 42 AND v.color_name = 'Cloud';

-- Aziza: delivered 20 days ago
WITH o AS (
  INSERT INTO orders (user_id, status, subtotal, shipping_fee, discount, total, address_line, city, phone, payment_method, created_at, updated_at)
  SELECT id, 'delivered', 580000, 0, 0, 580000, 'Mirzo Ulugbek 41, apt 7', 'Tashkent', '+998 91 222 33 44', 'cash', now() - interval '20 days', now() - interval '16 days'
    FROM users WHERE email = 'aziza@demo.uz' RETURNING id)
INSERT INTO order_items (order_id, variant_id, product_id, product_name, brand_name, size, color_name, color_hex, art_style, unit_price, qty)
SELECT o.id, v.id, p.id, p.name, b.name, v.size, v.color_name, v.color_hex, p.art_style, p.price, 1
  FROM o, variants v JOIN products p ON p.id = v.product_id JOIN brands b ON b.id = p.brand_id
 WHERE p.name = 'Cloud Walker' AND v.size = 38 AND v.color_name = 'Cream';

-- Status history of those orders: new -> processing -> shipped -> delivered, up to the current status
INSERT INTO order_status_log (order_id, status, changed_by, created_at)
SELECT o.id, s.status,
       CASE WHEN s.status = 'new' THEN o.user_id ELSE (SELECT id FROM users WHERE email = 'admin@shushop.uz') END,
       o.created_at + s.step * interval '10 hours'
  FROM orders o
  JOIN (VALUES ('new', 0), ('processing', 1), ('shipped', 2), ('delivered', 3)) AS s(status, step)
    ON s.step <= CASE o.status WHEN 'new' THEN 0 WHEN 'processing' THEN 1 WHEN 'shipped' THEN 2 ELSE 3 END;

-- ------------------------------------------------------------ wishlist, alerts, reviews
INSERT INTO favourites (user_id, product_id, created_at)
SELECT u.id, p.id, now() - interval '3 days'
  FROM users u JOIN products p ON p.name IN ('Urban Step', 'Swift Run', 'AirFlex Sneakers', 'Cloud Walker', 'Metro Hi')
 WHERE u.email = 'alex@demo.uz';

INSERT INTO favourites (user_id, product_id)
SELECT u.id, p.id FROM users u JOIN products p ON p.name IN ('Cloud Walker', 'Velvet Slip') WHERE u.email = 'aziza@demo.uz';

INSERT INTO stock_alerts (user_id, product_id)
SELECT u.id, p.id FROM users u, products p WHERE u.email = 'alex@demo.uz' AND p.name = 'Urban Step';

-- Two or three reviews per shoe, 3-5 stars (repeatable pseudo-random choice)
INSERT INTO reviews (product_id, user_id, rating, comment, created_at)
SELECT p.id, u.id,
       CASE abs(hashtext(p.name || u.email)) % 7 WHEN 0 THEN 3 WHEN 1 THEN 4 WHEN 2 THEN 4 ELSE 5 END,
       (ARRAY['Very comfortable and true to size.', 'Great quality for the price.', 'Looks even better in real life.',
              'Light and breathable, I wear them every day.', 'Fast delivery and neat packaging.'])[1 + abs(hashtext(u.email || p.name)) % 5],
       now() - (1 + abs(hashtext(p.name || u.email)) % 60) * interval '1 day'
  FROM products p CROSS JOIN users u
 WHERE u.role = 'customer' AND abs(hashtext(u.email || p.name || 'r')) % 4 <> 0;

-- ------------------------------------------------------------ notifications for Alex (as in the wireframe)
INSERT INTO notifications (user_id, kind, title, body, product_id, order_id, is_read, created_at)
SELECT u.id, 'restock', 'Restock alert', 'The Urban Step restock is live in your size.', p.id, NULL, false, now() - interval '2 minutes'
  FROM users u, products p WHERE u.email = 'alex@demo.uz' AND p.name = 'Urban Step';

INSERT INTO notifications (user_id, kind, title, body, product_id, order_id, is_read, created_at)
SELECT u.id, 'order', 'Order update', 'Your Swift Run order has shipped.', NULL, o.id, false, now() - interval '18 minutes'
  FROM users u JOIN orders o ON o.user_id = u.id AND o.status = 'shipped' WHERE u.email = 'alex@demo.uz';

INSERT INTO notifications (user_id, kind, title, body, product_id, order_id, is_read, created_at)
SELECT u.id, 'price_drop', 'Price drop', 'The Urban Step is now 720 000 so''m.', p.id, NULL, true, now() - interval '1 hour'
  FROM users u, products p WHERE u.email = 'alex@demo.uz' AND p.name = 'Urban Step';

INSERT INTO notifications (user_id, kind, title, body, product_id, order_id, is_read, created_at)
SELECT u.id, 'drop', 'New drop alert', 'Metro Hi just landed in Olive and Sand.', p.id, NULL, true, now() - interval '1 day'
  FROM users u, products p WHERE u.email = 'alex@demo.uz' AND p.name = 'Metro Hi';

END
$seed$;

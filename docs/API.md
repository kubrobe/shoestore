# Shushop REST API

One API serves the website and the Android app. All bodies are JSON (`Content-Type: application/json`). Money is a whole number of so'm. Times are ISO 8601 strings (UTC).

## Signing in

| Client | How the session travels |
| --- | --- |
| Website | `POST /api/login` sets an `httpOnly` cookie (30 days). The browser sends it by itself. |
| Android app | `POST /api/mobile/login` returns `{ "token": "...", "user": {...} }`. Send `Authorization: Bearer <token>` on every call. |

Both are the same kind of session on the server (only a SHA-256 hash of the token is stored). `POST .../logout` ends it.

**Errors** always look like `{ "error": "Readable message" }` with a fitting status: `400` bad input, `401` not signed in, `403` not allowed (admin only), `404` not found, `409` conflict (for example the stock changed), `429` too many login attempts, `500` our fault.

**`PATCH` from the app**: some Android HTTP stacks cannot send `PATCH`. The server accepts `POST` with the header `X-HTTP-Method-Override: PATCH` and treats it as `PATCH`.

## Public

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | `{ "ok": true }`, or `503 { "ok": false }` when the database is down |
| `GET /api/meta` | Shop rules: shipping fee, free-shipping limit, max quantity, payment methods, order statuses, categories, brands, size range, sort names |
| `GET /api/products` | List. Query: `search`, `category` (`men` `women` `kids` `sale`), `brand`, `size` (only sizes in stock), `min`, `max` (price), `sort` (`popular` `price_asc` `price_desc` `newest` `rating`), `limit` (1-100, default 40), `offset`. Returns `{ products, total, limit, offset }` |
| `GET /api/products/:id` | One shoe with `variants` (size, colour, stock), `reviews`, `ratingBreakdown`, `hasAlert`, `canReview` |
| `GET /img/shoe/:id.svg` | The drawn picture of a shoe. Optional `?c=%23aabbcc` for a colour |
| `POST /api/register` · `POST /api/login` · `POST /api/logout` | Website sign-up / sign-in (cookie) |
| `POST /api/mobile/register` · `POST /api/mobile/login` · `POST /api/mobile/logout` | Same for the app (token in the answer) |
| `GET /api/me` | `{ "user": {...} }` or `{ "user": null }` |

Register body: `{ "fullName", "email", "password" (8-72 chars), "phone"? }` (the shoe size is set later with `PATCH /api/me`). Login body: `{ "email", "password" }`.

## Signed-in customer

| Method and path | Purpose |
| --- | --- |
| `GET /api/mobile/sync` | **Everything for the app in one answer**: `shop` rules, `user`, all active `products` with `variants`, `stockAlertProductIds`, `cart`, `addresses`, `orders` (latest 100, with items), `notifications` (latest 50), `unreadCount`. The app replaces its offline copy with it in one database transaction. |
| `GET /api/summary` | Badge numbers: `cartCount`, `unreadCount`, `favouriteCount`, `activeOrders` |
| `PATCH /api/me` | `{ fullName?, phone?, shoeSizeEu? }` (`null` clears the size) |
| `POST /api/me/password` | `{ currentPassword, newPassword }` |
| `GET /api/favourites` · `PUT/DELETE /api/favourites/:productId` | Saved shoes |
| `PUT/DELETE /api/products/:id/alert` | Tell me when a sold-out shoe is back |
| `POST /api/products/:id/reviews` | `{ rating 1-5, comment? }`. Only after a delivered order with this shoe; one review per person (sending again edits it) |
| `GET /api/cart` | `{ items, count, subtotal }` |
| `POST /api/cart/items` | `{ variantId, qty? }` adds (checks stock and the limit of 10) |
| `PUT /api/cart/items/:variantId` | `{ qty }` sets the quantity; `0` removes |
| `DELETE /api/cart/items/:variantId` · `DELETE /api/cart` | Remove one line / empty the cart |
| `GET/POST /api/addresses` · `PUT/DELETE /api/addresses/:id` | Saved delivery addresses |
| `POST /api/checkout/quote` | `{ coupon? }` → `{ subtotal, discount, shipping, total, coupon }`, no changes made |
| `POST /api/checkout` | `{ paymentMethod, addressId? or address: { line, city, phone }, coupon? }` → `201 { order }`. One transaction: lock stock, check it, write the order, lower the stock, clear the cart, notify. If any line is no longer available nothing is saved and you get `409` with the reason. |
| `GET /api/orders` · `GET /api/orders/:id` | History; the detail also has the status timeline |
| `POST /api/orders/:id/cancel` | Allowed while the order is `new` or `processing`; stock goes back on the shelf |
| `GET /api/notifications` | `{ notifications, unreadCount }` |
| `POST /api/notifications/read-all` · `POST /api/notifications/:id/read` | Mark as read |

### Price rules (`src/rules.js`)

```
discount = floor(subtotal * couponPercent / 100)
shipping = 0 when the cart is empty or (subtotal - discount) >= 500 000, otherwise 25 000
total    = subtotal - discount + shipping
```

Payment methods: `cash`, `card`, `payme`, `click` (the shop records the choice; no money is moved by this project). Coupons in the demo data: `WELCOME10` (10 %), `SNEAKER15` (15 %, minimum order 600 000 so'm).

Order statuses: `new → processing → shipped → delivered`, or `cancelled` from `new`, `processing` or `shipped` (by the owner). `delivered` and `cancelled` are final.

## Shop owner (role `admin`)

Every call needs an admin session; anybody else gets `403`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/admin/stats` | Sales, orders by status, low stock, best sellers |
| `GET/POST /api/admin/products` · `GET/PUT/DELETE /api/admin/products/:id` | Catalogue. A price drop notifies people who saved the shoe |
| `POST /api/admin/products/:id/variants` · `PUT/DELETE /api/admin/variants/:id` | Size-colour stock. Raising stock from 0 notifies people with a stock alert |
| `GET /api/admin/orders?status=` · `GET /api/admin/orders/:id` | All orders |
| `PATCH /api/admin/orders/:id/status` | `{ status }`, only along the allowed path; the customer is notified |
| `GET/POST /api/admin/coupons` · `PATCH/DELETE /api/admin/coupons/:code` | Coupons (1-90 %, optional minimum order) |
| `POST /api/admin/announce` | `{ title?, body, productId? }` sends a notification to every customer |
| `GET /api/admin/customers` | Customer list with order counts |

## Example

```bash
BASE=https://shushop.onrender.com
TOKEN=$(curl -s $BASE/api/mobile/login -H 'content-type: application/json' \
        -d '{"email":"alex@demo.uz","password":"demo12345"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s $BASE/api/mobile/sync -H "Authorization: Bearer $TOKEN" | head -c 400
```

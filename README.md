# Shushop - website and server

Shushop is an online shoe store. This repository holds the **website** and the **server (REST API)**. The Android app lives in a second repository and talks to the same server, so the shop, the cart, the orders and the notifications are always the same on the phone and in the browser.

| Part | Repository |
| --- | --- |
| Website + REST API + database scripts | this repository (`kubrobe/shoestore`) |
| Android app (Kotlin, Jetpack Compose, Room) | `kubrobe/shoestore_android` |

```
 browser ──┐                              ┌── PostgreSQL (Supabase)
           ├──►  Node + Express (Render) ─┤
 phone ────┘     one REST API             └── same tables for everybody
```

All shoes, brands and people in the demo data are made up. Prices are in so'm (UZS), whole numbers only.

## What the shop does

**Customers**
- Browse the shop, search by name, filter by Men / Women / Kids / Sale, brand, size and price, sort the list.
- Shoe page: pick a colour and a size (sizes that are sold out are greyed), choose a quantity, add to cart, read and write reviews.
- Heart a shoe to save it. Ask to be told when a sold-out shoe is back ("stock alert").
- Cart and checkout with delivery address, payment method (cash, card, Payme, Click) and coupon codes.
- Order history with a status timeline. A new order can be cancelled until it ships.
- Notifications for price drops, restocks and order updates (All / Price drops / Restocks / Orders).
- Profile with shoe size, saved addresses and password change.

**Shop owner (admin)** - sign in with an admin account and open `/admin.html`
- Dashboard with sales numbers, add / edit / hide shoes and their size-colour stock.
- Orders: filter by status and move an order forward (new → processing → shipped → delivered, or cancelled).
- Coupons: create, switch off, delete. Send an "announce" notification to every customer.

## Run it on your computer

You need Node.js 20 or newer and PostgreSQL 14 or newer.

```bash
npm install
cp .env.example .env          # then put your DATABASE_URL in .env
npm run db:reset              # creates the tables and loads the demo data
npm start                     # http://localhost:3000
```

Demo accounts (password `demo12345`): `alex@demo.uz`, `aziza@demo.uz`, `bobur@demo.uz`.
Admin: `admin@shushop.uz` / `admin12345` - **change this password before the shop is public** (see below).

### Tests

The tests run against a real PostgreSQL database and **empty and refill it**, so give them their own database:

```bash
createdb shushop_test
TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/shushop_test npm test
```

59 tests cover registration and login (cookie and app token), the product list and filters, stock rules, the cart, checkout (the whole checkout is one database transaction, so two people cannot buy the last pair), cancelling, notifications, the admin panel, and the mobile sync endpoint.

### Handy scripts

| Command | What it does |
| --- | --- |
| `npm run db:reset` | Drops Shushop's tables and recreates them with demo data |
| `npm run db:build-sql` | Rebuilds `db/supabase_setup.sql` and `db/supabase_schema_only.sql` from `schema.sql` / `seed.sql` |
| `npm run user:password -- email@x.uz "new password"` | Changes any account's password and logs it out everywhere |
| `npm run user:admin -- owner@x.uz "Owner Name" "password"` | Creates (or promotes) a shop-owner account |

## Put it online

The short version: **Supabase** holds the data, **Render** runs this server, and both the website and the app use the Render address. Step by step instructions are in [docs/DEPLOY.md](docs/DEPLOY.md).

## How it is built

```
server.js          starts Express, security headers, JSON parsing, error handling, static files
src/auth.js        register / login / logout - cookie for the website, Bearer token for the app
src/catalog.js     product list (search, filters, sort), product page, reviews, shoe pictures
src/shop.js        profile, favourites, stock alerts, cart, addresses, checkout, orders
src/mobile.js      GET /api/mobile/sync - everything the app needs in one consistent answer
src/admin.js       admin-only: stats, products, variants, orders, coupons, announcements
src/rules.js       shipping fee, free-shipping limit, coupon maths, order statuses (one place for every client)
src/notify.js      creates notifications (order updates, restocks, price drops)
src/validate.js    input cleaning; HttpError
db/schema.sql      tables      db/seed.sql  demo data
public/            the website (plain HTML, CSS and JavaScript modules, no build step)
tests/             node:test suites
docs/              DEPLOY.md, API.md, DEMO.md, erd.mmd
```

Design decisions worth knowing:

- **Money is stored as whole so'm** (`BIGINT`). No decimals, so no rounding errors.
- **Prices of an order are copied into `order_items`** at checkout, so changing a shoe's price later never changes an old order.
- **Checkout is one transaction** that locks the stock rows (`SELECT ... FOR UPDATE`), checks stock, writes the order and its items, lowers the stock, clears the cart and creates the notification. If anything fails, nothing is saved.
- **Sessions**: a random token is given to the client and only its SHA-256 hash is stored. The website receives it in an `httpOnly` cookie; the app sends `Authorization: Bearer <token>`.
- **Passwords** are hashed with bcrypt. Logging in is rate-limited per address and email.
- **Security headers**: strict Content-Security-Policy (no inline scripts), `frame-ancestors 'none'`, `nosniff`.
- **One set of rules**: the Android app reads shipping fee, free-shipping limit, payment methods and so on from `GET /api/meta`, so the website, the app and the tests cannot disagree.

## Before you go live (checklist)

1. Change the admin password: `npm run user:password -- admin@shushop.uz "a long new password"` (run it with the production `DATABASE_URL`), or create your own owner account with `npm run user:admin` and delete the demo one.
2. Keep `DATABASE_URL` only in Render's environment settings. Never commit `.env`.
3. Replace the demo shoes with the real catalogue from `/admin.html` (or load `db/supabase_schema_only.sql` so you start with empty tables).
4. Render's free plan sleeps after some idle minutes; the first request after that takes about 30-50 seconds. Upgrade the plan before real customers arrive.

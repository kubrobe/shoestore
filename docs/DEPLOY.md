# Putting Shushop online

Three pieces, all with free plans:

1. **GitHub** - the code (this repository). Render pulls it from here.
2. **Supabase** - the PostgreSQL database.
3. **Render** - runs the Node server. The website and the Android app both talk to its address.

The order matters: database first, then the server, then the app.

## 1. Database on Supabase (about 5 minutes)

1. On [supabase.com](https://supabase.com) create a **New project**. Pick the region closest to your Render region (for example Frankfurt for both). Choose a database password and **save it** in a password manager - Supabase will not show it again.
2. Open **SQL Editor → New query**. Paste the whole content of one of these files and press **Run**:
   - `db/supabase_setup.sql` - tables **and** the demo shoes, customers and orders. Good for a first test.
   - `db/supabase_schema_only.sql` - empty tables only. Use this for the real shop, then create your owner account (step 4) and add shoes in the admin page.

   Both files start by dropping Shushop's own tables, so running them again **erases the shop's data**. Never run them on a live shop that has real orders.
3. Get the connection string: **Project Settings → Database → Connection string**, choose **Transaction pooler** (port 6543) and copy the URI. Replace `[YOUR-PASSWORD]` with the password from step 1. If the password contains characters like `@ : / # ?`, replace each with its percent-code (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `?` → `%3F`) or simply choose a password with letters and digits only.

   Why the pooler and not "Direct connection": the direct address only works over IPv6 on Supabase's free plan, and Render connects over IPv4.

Keep this connection string private. It goes **only** into Render's environment settings (next step), never into the code, GitHub, or a chat.

The server trusts Supabase's certificate automatically (`certs/supabase-ca.crt`), so no extra SSL settings are needed. For another database provider, set `DB_SSL_CA` (the certificate text) or `DB_SSL_CA_FILE` in Render.

## 2. Server on Render (about 10 minutes)

1. Make sure the code is on GitHub (`kubrobe/shoestore`, branch `main`).
2. In the [Render dashboard](https://dashboard.render.com), open your project and choose **New → Blueprint**, select the repository and let Render read `render.yaml`. (Or **New → Web Service** and enter these by hand: Runtime *Node*, Build Command `npm install`, Start Command `npm start`, Health Check Path `/api/health`, plan *Free*.)
3. When Render asks for the secret values, enter:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase connection string from step 1 |
   | `NODE_ENV` | `production` (already in the blueprint) |

   Leave `DB_SSL_CA` empty when you use Supabase.
4. Press **Apply / Create**. The first build takes a few minutes.
5. When the service is **Live**, open `https://<your-service>.onrender.com/api/health`. It must answer `{"ok":true}`. Then open the address itself: the shop appears.

The service is named `shushop` in `render.yaml`, which gives `https://shushop.onrender.com` if that name is free. If Render adds a suffix, use the address it shows at the top of the service page - you will need it for the Android app.

## 3. Secure the owner account

The demo data contains the admin `admin@shushop.uz` with the public password `admin12345`. Change it right away. On your computer, put the production connection string in `.env` (the file is ignored by git) and run:

```bash
npm install
npm run user:password -- admin@shushop.uz "a long password only you know"
```

Or create the real owner and stop using the demo admin:

```bash
npm run user:admin -- owner@yourshop.uz "Owner Name" "a long password only you know"
```

Then sign in at `/login.html` and open `/admin.html`.

## 4. Connect the Android app

The app needs the Render address:

- **At build time**: add `shushopApiUrl=https://your-service.onrender.com` to `gradle.properties` (or `~/.gradle/gradle.properties`) of the Android project, then build again.
- **Without rebuilding**: on the app's login screen tap **Server** at the bottom and type the address.

For testing against a server on your own computer: the Android emulator reaches it at `http://10.0.2.2:3000`; a real phone on the same Wi-Fi uses your computer's address (for example `http://192.168.1.20:3000`). Plain `http` works in the debug build only.

## Problems and fixes

| What you see | Why | Fix |
| --- | --- | --- |
| First page takes 30-50 seconds | Render's free plan sleeps when idle | Wait once; or use a paid plan for the real shop |
| `/api/health` says `{"ok":false}` or the log shows `password authentication failed` | Wrong `DATABASE_URL` or password | Re-copy the string, check the password and percent-codes |
| `ENOTFOUND` / `ENETUNREACH` in the log | You used the Direct connection | Use the Transaction pooler string |
| `self-signed certificate` in the log | Database is not on Supabase | Set `DB_SSL_CA` to your provider's CA certificate |
| Shop opens but is empty | The SQL from step 1 was not run, or `schema_only` was used | Run `db/supabase_setup.sql`, or add shoes in `/admin.html` |
| Supabase project "paused" | Free projects pause after about a week without use | Press *Restore* in the Supabase dashboard |
| The app says it cannot reach the server | Wrong address, or the server is waking up | Check the **Server** address on the login screen; try again after a minute |

## Updating the shop

Push to `main` on GitHub; Render builds and deploys automatically. Database changes are not automatic: if you change `db/schema.sql`, apply the change in Supabase's SQL editor yourself (a plain `ALTER TABLE ...`), and do **not** rerun the setup files on a live shop.

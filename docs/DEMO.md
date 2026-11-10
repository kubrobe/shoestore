# Demo script (about 5 minutes)

Use this to show the project to a teacher or to the shop owner. It works on the live site or on `npm start` with the demo data.

## Accounts

| Who | Email | Password |
| --- | --- | --- |
| Customer | `alex@demo.uz` | `demo12345` |
| Customer | `aziza@demo.uz` | `demo12345` |
| Shop owner | `admin@shushop.uz` | `admin12345` (change it on a live shop!) |

Coupons: `WELCOME10` (10 % off) and `SNEAKER15` (15 % off orders from 600 000 so'm).

## One shop, two screens

Open the website in the browser and the Android app (emulator or phone) side by side, both signed in as `alex@demo.uz`.

1. **Shop** - search "air", tap the *Sale* chip, filter by size 42. The same list appears in the app (it reads its offline copy and refreshes from the server).
2. **Shoe page** - choose a colour (the picture repaints), a size (sold-out sizes are greyed), quantity 2, *Add to cart*. Open the app: pull to refresh on the shop screen - the cart badge shows the same number.
3. **Checkout** - enter `WELCOME10`, watch discount, delivery fee (free from 500 000 so'm after discount) and total change. Pick *Cash*, *Confirm Order*.
4. **Order status** - open the website as the owner (private window): `/admin.html` → *Orders* → press *Start packing*, then *Send out* on the new order. In the app, the *Notifications* tab shows an unread dot and "Your order has shipped."
5. **Cancel rule** - as the customer, an order that is *Shipped* can no longer be cancelled; a *New* one can, and the pairs go back on the shelf.
6. **Stock alert** - find a sold-out size, tap *Tell me when it's back*. As the owner raise that size's stock in *Shoes*. The customer gets a *Restock* notification on both the site and the app.
7. **Race** - two customers try to buy the last pair at the same moment: one order succeeds, the other gets "just sold out" and nothing is half-saved (checkout is one database transaction).

## What to say about the code

- The server (`src/`) holds every rule; the website and the app only show things.
- One endpoint, `GET /api/mobile/sync`, lets the app rebuild its Room database in a single transaction, so offline data is never half-updated.
- 59 server tests (`npm test`) and 85 unit tests in the Android project.

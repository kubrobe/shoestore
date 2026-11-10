// Business rules in ONE place: shipping, discounts, order statuses. The website, the Android app and the tests
// all get their numbers from here (the app receives them from GET /api/meta), so they can never disagree.
import { HttpError } from './validate.js';

export const SHIPPING_FEE = 25_000;          // so'm, charged when the order is under FREE_SHIPPING_FROM
export const FREE_SHIPPING_FROM = 500_000;   // so'm (after discount)
export const MAX_QTY = 10;                   // per size and colour in one cart
export const PAYMENT_METHODS = ['cash', 'card', 'payme', 'click'];
export const ORDER_STATUSES = ['new', 'processing', 'shipped', 'delivered', 'cancelled'];

// Which status can follow which (admin changes). A delivered or cancelled order is final.
export const NEXT_STATUS = {
  new: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

// 650000 -> "650 000 so'm"
export const formatSom = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";

// Subtotal + coupon percent -> everything the customer pays.
export function priceOrder(subtotal, couponPercent = 0) {
  const discount = Math.floor((subtotal * couponPercent) / 100);
  const afterDiscount = subtotal - discount;
  const shipping = subtotal === 0 || afterDiscount >= FREE_SHIPPING_FROM ? 0 : SHIPPING_FEE;
  return { subtotal, discount, shipping, total: afterDiscount + shipping };
}

// Looks a coupon code up and checks it can be used for this subtotal. Returns the coupon row or null (no code given).
export async function loadCoupon(db, code, subtotal) {
  const clean = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!clean) return null;
  const r = await db.query(
    'SELECT code, percent, min_total FROM coupons WHERE code = $1 AND active AND (expires_at IS NULL OR expires_at > now())', [clean]);
  if (!r.rows[0]) throw new HttpError(400, 'This coupon code is not valid');
  if (subtotal < r.rows[0].min_total) {
    throw new HttpError(400, `This coupon needs an order of at least ${formatSom(r.rows[0].min_total)}`);
  }
  return r.rows[0];
}

export const statusMessage = (status, firstItem, more) => {
  const what = more > 0 ? `${firstItem} and ${more} more` : firstItem;
  switch (status) {
    case 'new': return `We received your ${what} order.`;
    case 'processing': return `Your ${what} order is being packed.`;
    case 'shipped': return `Your ${what} order has shipped.`;
    case 'delivered': return `Your ${what} order was delivered. Enjoy! You can now review it.`;
    case 'cancelled': return `Your ${what} order was cancelled.`;
    default: return `Your ${what} order changed.`;
  }
};

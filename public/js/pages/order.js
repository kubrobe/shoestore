import { get, post } from '../api.js';
import { mountShell, h, icon, money, plural, itemImg, statusChip, empty, requireLogin, params, fmtDateTime, fmtDate, toast, errorText, confirmSheet, PAYMENT_LABEL, refreshBadges } from '../ui.js';

const { user, main } = await mountShell({ page: 'order' });
if (!requireLogin(user)) throw new Error('login needed');
const id = Number(params().get('id'));
document.title = `Order ${id} - Shushop`;

let order;
async function load() { order = (await get(`/api/orders/${id}`)).order; }
try { await load(); } catch {
  main.append(empty({ title: 'We could not find that order', action: { href: '/orders.html', label: 'See your orders' } }));
  throw new Error('order not found');
}

const STEPS = [['new', 'Placed'], ['processing', 'Packing'], ['shipped', 'On the way'], ['delivered', 'Delivered']];
const root = h('div', { class: 'stack', style: { gap: '22px' } });
main.append(root);

async function cancel() {
  const ok = await confirmSheet({ title: 'Cancel this order?', text: 'The pairs go back to the shop and you will not be charged.', confirm: 'Cancel order', danger: true });
  if (!ok) return;
  try { await post(`/api/orders/${id}/cancel`); await load(); draw(); toast('Order cancelled'); refreshBadges(); } catch (e) { toast(errorText(e), 'error'); }
}

function draw() {
  root.replaceChildren();
  const reached = new Map(order.history.map((x) => [x.status, x.at]));
  const idx = STEPS.findIndex(([s]) => s === order.status);
  root.append(
    h('div', { class: 'page-head', style: { paddingBottom: '0' } }, h('a', { class: 'iconbtn solid', href: '/orders.html', 'aria-label': 'Back to orders' }, icon('back')), h('h1', {}, `Order ${order.id}`), statusChip(order.status)),
    params().get('placed') ? h('div', { class: 'banner' }, icon('check', 22), 'Thank you. Your order is placed and we are getting it ready.') : null,
    order.status === 'cancelled'
      ? h('div', { class: 'panel' }, h('h3', {}, 'This order was cancelled'), h('p', { class: 'muted' }, `Cancelled on ${fmtDateTime(reached.get('cancelled') || order.updatedAt)}.`))
      : h('div', { class: 'steps', role: 'list', 'aria-label': 'Order progress' }, STEPS.map(([s, label], n) => h('div', { class: `step ${n <= idx ? 'done' : ''}`, role: 'listitem' },
          h('i', {}, n <= idx ? icon('check', 16) : null), h('span', {}, label), h('span', { class: 'small muted' }, reached.get(s) ? fmtDate(reached.get(s)) : '')))),
    h('div', { class: 'lines' }, order.items.map((i) => h('div', { class: 'line-item' },
      h('div', { class: 'shoe-tile' }, itemImg(i)),
      h('div', {}, h('h3', {}, i.name), h('div', { class: 'meta' }, h('span', { class: 'swatch', style: { '--c': i.colorHex } }), `${i.colorName}, size ${i.size}`),
        order.status === 'delivered' && i.productId ? h('a', { class: 'link small', href: `/product.html?id=${i.productId}#rev-h` }, 'Rate this shoe') : null),
      h('div', { class: 'side' }, h('span', { class: 'price' }, money(i.unitPrice * i.qty)), h('span', { class: 'small muted' }, `${plural(i.qty, 'pair')}`))))),
    h('div', { class: 'summary' },
      h('div', { class: 'sum-row' }, h('span', {}, `Total items (${order.itemCount})`), h('span', {}, money(order.subtotal))),
      h('div', { class: 'sum-row' }, h('span', {}, 'Shipping fee'), h('span', {}, order.shippingFee ? money(order.shippingFee) : "0 so'm")),
      h('div', { class: 'sum-row' }, h('span', {}, order.couponCode ? `Discount (${order.couponCode})` : 'Discount'), h('span', {}, order.discount ? `-${money(order.discount)}` : "0 so'm")),
      h('div', { class: 'sum-row total' }, h('span', {}, 'Total cost'), h('span', {}, money(order.total)))),
    h('div', { class: 'panel' }, h('h3', {}, 'Delivery'), h('div', {}, `${order.addressLine}, ${order.city}`), h('div', { class: 'muted' }, order.phone), h('div', { class: 'muted' }, `${PAYMENT_LABEL[order.paymentMethod]}. Placed ${fmtDateTime(order.createdAt)}.`)),
    ['new', 'processing'].includes(order.status) ? h('button', { class: 'btn danger', type: 'button', onclick: cancel }, 'Cancel order') : null);
}
draw();

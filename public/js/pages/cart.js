import { get, post, put, del } from '../api.js';
import { mountShell, h, icon, clear, money, plural, itemImg, shoeImg, toast, errorText, requireLogin, empty, openSheet, refreshBadges, PAYMENT_LABEL } from '../ui.js';

const { user, main } = await mountShell({ page: 'cart' });
if (!requireLogin(user)) throw new Error('login needed');
document.title = 'Cart - Shushop';

const meta = await get('/api/meta');
const st = { cart: null, addresses: [], addressId: null, payment: 'cash', coupon: '', quote: null, couponMsg: '', busy: false };
const PAYMENT_HELP = { cash: 'Pay the courier in cash', card: 'Pay the courier by card', payme: 'Pay with the Payme app on delivery', click: 'Pay with the Click app on delivery' };

const root = h('div');
main.append(root);

async function loadAll() {
  const [cart, addr] = await Promise.all([get('/api/cart'), get('/api/addresses')]);
  st.cart = cart; st.addresses = addr.addresses;
  if (!st.addresses.some((a) => a.id === st.addressId)) st.addressId = (st.addresses.find((a) => a.isDefault) || st.addresses[0])?.id ?? null;
  await requote();
}

// Ask the server for the price, so the page and the final order can never disagree.
async function requote() {
  st.couponMsg = '';
  if (!st.cart.items.length) { st.quote = null; return; }
  try {
    st.quote = await post('/api/checkout/quote', { coupon: st.coupon });
  } catch (e) {
    if (st.coupon) { st.couponMsg = errorText(e); st.coupon = ''; st.quote = await post('/api/checkout/quote', { coupon: '' }); } else throw e;
  }
}

async function setQty(item, qty) {
  try { st.cart = await put(`/api/cart/items/${item.variantId}`, { qty }); await requote(); } catch (e) { toast(errorText(e), 'error'); st.cart = await get('/api/cart'); await requote(); }
  draw(); refreshBadges();
}

function lineItem(i) {
  const max = Math.min(i.stock, meta.maxQtyPerItem);
  return h('div', { class: 'line-item' },
    h('a', { class: 'shoe-tile', href: `/product.html?id=${i.productId}`, 'aria-label': i.name }, shoeImg({ id: i.productId, name: i.name, imageUrl: i.imageUrl }, { color: i.colorHex })),
    h('div', {}, h('h3', {}, i.name), h('div', { class: 'meta' }, h('span', { class: 'swatch', style: { '--c': i.colorHex } }), `${i.colorName}, size ${i.size}`), h('div', { class: 'price', style: { marginTop: '6px' } }, money(i.unitPrice))),
    h('div', { class: 'side' },
      h('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Remove ${i.name}`, onclick: () => setQty(i, 0) }, icon('trash', 18)),
      h('div', { class: 'qty' },
        h('button', { type: 'button', 'aria-label': 'One less', disabled: i.qty <= 1, onclick: () => setQty(i, i.qty - 1) }, icon('minus', 16)),
        h('output', {}, String(i.qty)),
        h('button', { type: 'button', 'aria-label': 'One more', disabled: i.qty >= max, onclick: () => setQty(i, i.qty + 1) }, icon('plus', 16)))),
    i.available ? null : h('div', { class: 'warn' }, i.stock === 0 ? 'Sold out. Remove it to continue.' : `Only ${plural(i.stock, 'pair')} left. Lower the quantity to continue.`));
}

function addressSheet() {
  const f = {};
  const field = (key, label, attrs = {}) => h('label', { class: 'field' }, h('span', {}, label), (f[key] = h('input', { class: 'input', ...attrs })));
  const msg = h('div', { class: 'error-text', role: 'alert' });
  const makeDefault = h('input', { type: 'checkbox', checked: st.addresses.length === 0 });
  const { close } = openSheet('Delivery address', h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    try {
      const r = await post('/api/addresses', { label: f.label.value, line: f.line.value, city: f.city.value, phone: f.phone.value, isDefault: makeDefault.checked });
      st.addressId = r.address.id; close(); await loadAll(); draw(); toast('Address saved');
    } catch (err) { msg.textContent = errorText(err); }
  } },
    field('label', 'Name for this address', { value: 'Home', maxlength: 30, required: true }),
    field('line', 'Street, house and flat', { placeholder: 'Chilonzor 9, apt 12', maxlength: 200, required: true, autocomplete: 'street-address' }),
    field('city', 'City', { value: 'Tashkent', maxlength: 60, required: true }),
    field('phone', 'Phone for the courier', { type: 'tel', value: user.phone || '', placeholder: '+998 90 123 45 67', required: true, autocomplete: 'tel' }),
    h('label', { class: 'check' }, makeDefault, 'Use as my main address'),
    msg, h('button', { class: 'btn', type: 'submit' }, 'Save address')));
}

async function confirm(btn) {
  const address = st.addresses.find((a) => a.id === st.addressId);
  if (!address) { toast('Add a delivery address first', 'error'); return; }
  st.busy = true; btn.disabled = true;
  try {
    const { order } = await post('/api/checkout', { addressId: st.addressId, paymentMethod: st.payment, coupon: st.coupon });
    location.href = `/order.html?id=${order.id}&placed=1`;
  } catch (e) {
    toast(errorText(e), 'error');
    await loadAll(); st.busy = false; draw(); refreshBadges();
  }
}

function draw() {
  clear(root);
  const head = h('div', { class: 'page-head' }, h('a', { class: 'iconbtn solid', href: '/', 'aria-label': 'Back to the shop' }, icon('back')), h('h1', {}, 'Checkout'));
  if (!st.cart.items.length) {
    root.append(head, empty({ title: 'Your cart is empty', text: 'Find a pair you like and it will wait here.', action: { href: '/', label: 'Browse shoes' } }));
    return;
  }
  const q = st.quote;
  const blocked = st.cart.hasUnavailable || st.busy || st.addressId === null;
  const toFree = Math.max(0, meta.freeShippingFrom - (q.subtotal - q.discount));

  const addressList = h('div', { class: 'pick-list' }, st.addresses.map((a) => h('button', { class: `pick ${a.id === st.addressId ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(a.id === st.addressId), onclick: () => { st.addressId = a.id; draw(); } },
    h('span', { class: 'radio' }), h('span', {}, h('b', {}, a.label), h('span', { class: 'sub' }, `${a.line}, ${a.city}`), h('br'), h('span', { class: 'sub' }, a.phone)))));
  const payList = h('div', { class: 'pick-list' }, meta.paymentMethods.map((m) => h('button', { class: `pick ${m === st.payment ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(m === st.payment), onclick: () => { st.payment = m; draw(); } },
    h('span', { class: 'radio' }), h('span', {}, h('b', {}, PAYMENT_LABEL[m]), h('span', { class: 'sub' }, PAYMENT_HELP[m])))));

  const couponInput = h('input', { class: 'input', placeholder: 'Coupon code', value: st.coupon, maxlength: 20, 'aria-label': 'Coupon code', autocapitalize: 'characters' });
  const applyCoupon = async () => { st.coupon = couponInput.value.trim().toUpperCase(); await requote(); draw(); };
  couponInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });

  const confirmBtn = h('button', { class: 'btn block', type: 'button', disabled: blocked, onclick: (e) => confirm(e.currentTarget) }, 'Confirm order, ', money(q.total));
  const summary = h('div', { class: 'summary' },
    h('div', { class: 'sum-row' }, h('span', {}, `Total items (${st.cart.count})`), h('span', {}, money(q.subtotal))),
    h('div', { class: 'sum-row' }, h('span', {}, 'Shipping fee'), q.shipping === 0 ? h('span', { class: 'good' }, '0 so\'m') : h('span', {}, money(q.shipping))),
    h('div', { class: 'sum-row' }, h('span', {}, q.coupon ? `Discount (${q.coupon.code}, ${q.coupon.percent}%)` : 'Discount'), h('span', {}, q.discount ? `-${money(q.discount)}` : "0 so'm")),
    h('div', { class: 'sum-row total' }, h('span', {}, 'Total cost'), h('span', {}, money(q.total))),
    toFree > 0 ? h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'progress' }, h('b', { style: { '--w': `${Math.min(100, ((meta.freeShippingFrom - toFree) / meta.freeShippingFrom) * 100)}%` } })), h('span', { class: 'small muted' }, `Add ${money(toFree)} more for free delivery.`)) : h('span', { class: 'small muted' }, 'Delivery is free on this order.'));

  root.append(head, h('div', { class: 'checkout' },
    h('div', { class: 'stack', style: { gap: '28px' } },
      h('section', {}, h('div', { class: 'lines' }, st.cart.items.map(lineItem))),
      h('section', {}, h('div', { class: 'section-title' }, h('h2', {}, 'Shipping information'), h('button', { class: 'link', type: 'button', onclick: addressSheet }, st.addresses.length ? 'Add address' : 'Add your address')),
        st.addresses.length ? addressList : h('p', { class: 'muted' }, 'Where should we deliver? Add an address to continue.')),
      h('section', {}, h('div', { class: 'section-title' }, h('h2', {}, 'Payment')), payList, h('p', { class: 'hint', style: { marginTop: '10px' } }, 'You pay when the courier arrives. Shushop never stores card details.'))),
    h('div', { class: 'aside stack' },
      h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'coupon' }, couponInput, h('button', { class: 'btn quiet sm', style: { height: '50px' }, type: 'button', onclick: applyCoupon }, 'Apply')), st.couponMsg ? h('div', { class: 'error-text', role: 'alert' }, st.couponMsg) : null),
      summary, confirmBtn,
      st.cart.hasUnavailable ? h('p', { class: 'error-text' }, 'Some shoes in your cart are no longer available in that amount.') : null)));
}

await loadAll();
draw();

import { get, post, put, del } from '../api.js';
import { mountShell, h, icon, clear, money, stars, shoeImg, heartButton, toast, errorText, requireLogin, params, empty, refreshBadges, plural, fmtDate } from '../ui.js';

const { user, main } = await mountShell({ page: 'product' });
const id = Number(params().get('id'));

let product;
try { product = (await get(`/api/products/${id}`)).product; } catch {
  main.append(empty({ title: 'We could not find that shoe', text: 'It may have been removed from the shop.', action: { href: '/', label: 'Back to the shop' } }));
  throw new Error('product not found');
}
document.title = `${product.name} - Shushop`;

// ---- what is selectable
const colors = [...new Map(product.variants.map((v) => [v.colorName, { name: v.colorName, hex: v.colorHex }])).values()];
const sizes = [...new Set(product.variants.map((v) => v.size))].sort((a, b) => a - b);
const variantOf = (size, colorName) => product.variants.find((v) => v.size === size && v.colorName === colorName);
const hasStock = (colorName) => product.variants.some((v) => v.colorName === colorName && v.stock > 0);
const sel = { color: (colors.find((c) => hasStock(c.name)) || colors[0] || {}).name, size: null, qty: 1 };
const preferred = user?.shoeSizeEu;
if (preferred && variantOf(preferred, sel.color)?.stock > 0) sel.size = preferred;

// ---- picture (repaints when the colour changes)
const tile = h('div', { class: 'pdp-tile' });
const back = h('a', { class: 'iconbtn solid pdp-back', href: history.length > 1 ? '#' : '/', 'aria-label': 'Back', onclick: (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } } }, icon('back'));
function drawPicture(animate) {
  const colorHex = colors.find((c) => c.name === sel.color)?.hex;
  const img = shoeImg(product, { color: colorHex, cls: animate ? 'swap' : '' });
  img.loading = 'eager';
  tile.replaceChildren(img, back, heartButton(product, user, { big: true }));
}

// ---- controls
const priceBox = h('div', { class: 'pdp-price' });
const sizesBox = h('div', { class: 'sizes', role: 'group', 'aria-label': 'Choose a size' });
const dotsBox = h('div', { class: 'dots', role: 'group', 'aria-label': 'Choose a colour' });
const stockNote = h('div', { class: 'stock-note', 'aria-live': 'polite' });
const qtyBox = h('div');
const actionBox = h('div', { class: 'buybar' });

function drawPrice() {
  clear(priceBox).append(money(product.price));
  if (product.onSale) priceBox.append(h('s', {}, money(product.oldPrice)), h('span', { class: 'off' }, `Save ${product.discountPercent}%`));
}
function drawSizes() {
  clear(sizesBox);
  for (const s of sizes) {
    const v = variantOf(s, sel.color);
    const ok = v && v.stock > 0;
    sizesBox.append(h('button', {
      class: `size ${sel.size === s ? 'on' : ''} ${ok ? '' : 'off'}`, type: 'button', 'aria-pressed': String(sel.size === s),
      'aria-label': `Size ${s}${ok ? '' : ', not available'}`, disabled: !ok,
      onclick: () => { sel.size = s; sel.qty = Math.min(sel.qty, variantOf(s, sel.color).stock); drawAll(false); },
    }, String(s)));
  }
}
function drawDots() {
  clear(dotsBox);
  for (const c of colors) {
    dotsBox.append(h('button', {
      class: `dot-btn ${sel.color === c.name ? 'on' : ''}`, type: 'button', style: { '--c': c.hex }, title: c.name, 'aria-label': `${c.name}${hasStock(c.name) ? '' : ', sold out'}`, 'aria-pressed': String(sel.color === c.name),
      onclick: () => {
        sel.color = c.name;
        if (sel.size && !(variantOf(sel.size, c.name)?.stock > 0)) sel.size = null;
        sel.qty = 1;
        drawAll(true);
      },
    }));
  }
}
function drawQty() {
  const v = sel.size ? variantOf(sel.size, sel.color) : null;
  const max = Math.min(v?.stock ?? 1, 10);
  clear(qtyBox).append(h('div', { class: 'qty', role: 'group', 'aria-label': 'Quantity' },
    h('button', { type: 'button', 'aria-label': 'One less', disabled: sel.qty <= 1, onclick: () => { sel.qty--; drawQty(); } }, icon('minus', 16)),
    h('output', { 'aria-live': 'polite' }, String(sel.qty)),
    h('button', { type: 'button', 'aria-label': 'One more', disabled: sel.qty >= max, onclick: () => { sel.qty++; drawQty(); } }, icon('plus', 16))));
}
async function toggleAlert() {
  if (!requireLogin(user)) return;
  try {
    if (product.hasAlert) { await del(`/api/products/${id}/alert`); product.hasAlert = false; toast('Alert switched off'); }
    else { await put(`/api/products/${id}/alert`); product.hasAlert = true; toast('We will tell you when it is back'); }
    drawAction();
  } catch (e) { toast(errorText(e), 'error'); }
}
async function addToCart(btn) {
  if (!user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
  const v = variantOf(sel.size, sel.color);
  btn.disabled = true;
  try {
    await post('/api/cart/items', { variantId: v.id, qty: sel.qty });
    await reloadStock();
    toast(`${product.name} added to your cart`, 'ok', { label: 'View cart', run: () => { location.href = '/cart.html'; } });
    refreshBadges();
  } catch (e) { toast(errorText(e), 'error'); await reloadStock(); }
  btn.disabled = false;
}
async function reloadStock() {       // somebody may have bought the last pair while this page was open
  try { const fresh = (await get(`/api/products/${id}`)).product; product.variants = fresh.variants; sel.qty = 1; drawAll(false); } catch { /* keep what we have */ }
}
function drawAction() {
  const v = sel.size ? variantOf(sel.size, sel.color) : null;
  clear(actionBox);
  if (!sel.size) {
    actionBox.append(hasStock(sel.color)
      ? h('button', { class: 'btn', type: 'button', disabled: true }, icon('bag', 20), 'Choose a size')
      : h('button', { class: 'btn quiet', type: 'button', onclick: toggleAlert }, icon('bell', 20), product.hasAlert ? 'We will tell you when it is back' : `Tell me when ${sel.color} is back`));
  } else if (v.stock === 0) {
    actionBox.append(h('button', { class: 'btn quiet', type: 'button', onclick: toggleAlert }, icon('bell', 20), product.hasAlert ? 'We will tell you when it is back' : 'Tell me when it is back'));
  } else {
    actionBox.append(h('button', { class: 'btn', type: 'button', onclick: (e) => addToCart(e.currentTarget) }, icon('bag', 20), `Add to cart, ${money(product.price * sel.qty)}`));
  }
  const v2 = sel.size ? variantOf(sel.size, sel.color) : null;
  stockNote.textContent = v2 && v2.stock > 0 && v2.stock <= 3 ? `Only ${plural(v2.stock, 'pair')} left in this size` : '';
}
function drawAll(animate) { drawPicture(animate); drawSizes(); drawDots(); drawQty(); drawAction(); }

// ---- reviews
const reviewsBox = h('section', { class: 'reviews', 'aria-labelledby': 'rev-h' });
function drawReviews() {
  clear(reviewsBox);
  reviewsBox.append(h('h2', { id: 'rev-h' }, product.reviewCount ? `Reviews (${product.reviewCount})` : 'Reviews'));
  if (product.reviewCount) {
    reviewsBox.append(h('div', { class: 'row' }, h('div', { class: 'pdp-price' }, product.avgRating.toFixed(1)), h('div', { class: 'bars grow' },
      [5, 4, 3, 2, 1].map((s) => h('div', { class: 'bar' }, h('span', {}, String(s)), h('i', {}, h('b', { style: { '--w': `${(product.ratingBreakdown[s] / product.reviewCount) * 100}%` } })), h('span', {}, String(product.ratingBreakdown[s]))))))
    );
  } else {
    reviewsBox.append(h('p', { class: 'muted' }, 'No reviews yet. Reviews open after an order with this shoe is delivered.'));
  }
  if (product.canReview) reviewsBox.append(reviewForm());
  for (const r of product.reviews) {
    reviewsBox.append(h('div', { class: 'review' },
      h('div', { class: 'row between' }, h('span', { class: 'who' }, r.mine ? `${r.author} (you)` : r.author), h('span', { class: 'small muted' }, fmtDate(r.createdAt))),
      stars(r.rating), r.comment ? h('p', {}, r.comment) : null));
  }
}
function reviewForm() {
  const mine = product.reviews.find((r) => r.mine);
  let rating = mine?.rating || 0;
  const pick = h('div', { class: 'star-pick', role: 'group', 'aria-label': 'Your rating' });
  const note = h('textarea', { class: 'input', maxlength: 500, placeholder: 'How do they fit and feel?', 'aria-label': 'Your review' });
  note.value = mine?.comment || '';
  const msg = h('div', { class: 'error-text', role: 'alert' });
  const drawPick = () => { clear(pick); for (let s = 1; s <= 5; s++) pick.append(h('button', { type: 'button', class: s <= rating ? 'on' : '', 'aria-label': `${s} star${s > 1 ? 's' : ''}`, onclick: () => { rating = s; drawPick(); } }, icon('star', 28))); };
  drawPick();
  return h('form', { class: 'panel', onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (!rating) { msg.textContent = 'Pick a star rating first.'; return; }
    try {
      await post(`/api/products/${id}/reviews`, { rating, comment: note.value });
      product = (await get(`/api/products/${id}`)).product;
      toast('Thanks for your review'); drawReviews(); drawPriceHead();
    } catch (err) { msg.textContent = errorText(err); }
  } }, h('h3', {}, mine ? 'Edit your review' : 'Rate this shoe'), pick, note, msg, h('button', { class: 'btn sm', type: 'submit', style: { alignSelf: 'flex-start' } }, mine ? 'Save review' : 'Post review'));
}

// ---- layout
const head = h('div');
function drawPriceHead() {
  clear(head).append(
    h('div', { class: 'pdp-title' }, h('div', { class: 'stack', style: { gap: '4px' } }, h('h1', {}, product.name), h('div', { class: 'muted' }, `${product.brand}, ${product.type.toLowerCase()}`)), priceBox),
    h('div', { class: 'row', style: { marginTop: '10px' } }, stars(product.avgRating, product.reviewCount), product.reviewCount ? h('a', { class: 'small muted', href: '#rev-h' }, 'Read reviews') : null));
  drawPrice();
}
drawPriceHead();

main.append(h('div', { class: 'pdp' }, tile, h('div', { class: 'stack', style: { gap: '22px' } },
  head,
  h('p', { class: 'pdp-desc' }, product.description || 'No description yet.'),
  h('div', { class: 'picker' }, h('div', {}, h('h3', {}, 'Colour'), dotsBox), h('div', {}, h('h3', {}, 'Choose a size'), sizesBox)),
  stockNote,
  h('div', { class: 'row between' }, h('h3', {}, 'Quantity'), qtyBox),
  actionBox)),
  reviewsBox);
drawAll(false);
drawReviews();

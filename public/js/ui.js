// Small UI toolkit shared by every page: element builder, icons, formatting, the page shell (top bar + tab pill),
// toasts, sheets and the shoe card. Text always goes in through text nodes, never through innerHTML.
import { get, put, del, ApiError } from './api.js';

// Element.append() would print the word "null" for a missing child; this version skips null/false and accepts arrays.
const nativeAppend = Element.prototype.append;
Element.prototype.append = function append(...nodes) {
  return nativeAppend.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
};

// ---------------------------------------------------------------- building elements
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') {                                       // CSSOM is allowed by our CSP (inline style="" is not)
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'selected', 'disabled'].includes(k)) el[k] = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { el.replaceChildren(); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------------------------------------------------------------- icons (stroke icons, drawn with SVG paths)
const ICONS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  heart: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'],
  user: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  bag: ['M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z', 'M3 6h18', 'M16 10a4 4 0 0 1-8 0'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.3-4.3'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  back: ['M19 12H5', 'm12 19-7-7 7-7'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  tag: ['M12.59 2.59a2 2 0 0 0-1.42-.59H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2 2 0 0 0 2.82 0l7.17-7.17a2 2 0 0 0 0-2.82z', 'M7.5 7.5h.01'],
  box: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'],
  pin: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  card: ['M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M2 10h20'],
  chat: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
  chevR: ['m9 18 6-6-6-6'],
  chevD: ['m6 9 6 6 6-6'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  bolt: ['M13 2 3 14h9l-1 8 10-12h-9z'],
  restock: ['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 21v-5h5'],
  key: ['M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4'],
};
const NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 22) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  if (name === 'star') svg.setAttribute('fill', 'currentColor');
  return svg;
}

// ---------------------------------------------------------------- formatting
export const money = (n) => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
export const STATUS_LABEL = { new: 'New', processing: 'Packing', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
export const PAYMENT_LABEL = { cash: 'Cash on delivery', card: 'Card to the courier', payme: 'Payme', click: 'Click' };
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const errorText = (e) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

// ---------------------------------------------------------------- pictures
// A shoe photo if the shop owner added one, otherwise the generated drawing in the chosen colour.
export function shoeImg(p, { color, cls = '' } = {}) {
  const src = p.imageUrl || `/img/shoe/${p.id}.svg${color ? `?c=${encodeURIComponent(color)}` : ''}`;
  return h('img', { src, alt: p.name, loading: 'lazy', class: `${p.imageUrl ? 'photo ' : ''}${cls}`.trim() || null, width: 600, height: 600 });
}
// An order line keeps its own copy of name, style and colour (the shoe may be gone from the shop).
export function itemImg(i) {
  return h('img', { src: `/img/shoe.svg?style=${encodeURIComponent(i.artStyle)}&c=${encodeURIComponent(i.colorHex)}`, alt: i.name, loading: 'lazy', width: 300, height: 300 });
}

// ---------------------------------------------------------------- toasts and sheets
export function toast(message, kind = 'ok', action) {
  let box = $('#toasts');
  if (!box) { box = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}` }, h('span', {}, message),
    action ? h('button', { type: 'button', onclick: () => { action.run(); t.remove(); } }, action.label) : null);
  box.append(t);
  setTimeout(() => t.remove(), action ? 6000 : 3500);
}

export function openSheet(title, content, { onClose } = {}) {
  const previous = document.activeElement;
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); previous?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'iconbtn solid', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x', 20))),
    content);
  const backdrop = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, sheet);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  sheet.querySelector('input, select, textarea, button.btn')?.focus();
  return { close, sheet };
}

export function confirmSheet({ title, text, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const { close } = openSheet(title, h('div', { class: 'stack' },
      h('p', { class: 'muted' }, text),
      h('div', { class: 'sheet-foot' },
        h('button', { class: 'btn quiet', type: 'button', onclick: () => { finish(false); close(); } }, 'Keep it'),
        h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'button', onclick: () => { finish(true); close(); } }, confirm))), { onClose: () => finish(false) });
  });
}

// ---------------------------------------------------------------- small widgets
export const stars = (avg, count) => h('span', { class: 'rate' }, icon('star', 14), avg ? avg.toFixed(1) : 'New', count ? ` (${count})` : null);
export const statusChip = (s) => h('span', { class: `status ${s}` }, STATUS_LABEL[s] || s);
export function empty({ title, text, action, art = true }) {
  return h('div', { class: 'empty' },
    art ? h('img', { class: 'art', src: '/img/shoe.svg?style=slip&c=%23d8d4cc', alt: '' }) : null,
    h('h2', {}, title), text ? h('p', {}, text) : null,
    action ? h('a', { class: 'btn', href: action.href }, action.label) : null);
}
export function skeletonGrid(n = 8) {
  return h('div', { class: 'grid' }, Array.from({ length: n }, () => h('div', { class: 'stack' }, h('div', { class: 'skel', style: { aspectRatio: '1 / 1.1' } }))));
}

// ---------------------------------------------------------------- page helpers
export const params = () => new URLSearchParams(location.search);
export function requireLogin(user) {
  if (user) return true;
  location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
  return false;
}
export const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

// The heart on a card or product page. Needs a login; tells the caller the new state.
export function heartButton(product, user, { big = false, onChange } = {}) {
  const btn = h('button', { class: `heart ${big ? 'big' : ''} ${product.isFavourite ? 'on' : ''}`, type: 'button', 'aria-label': 'Save shoe', 'aria-pressed': String(!!product.isFavourite) }, icon('heart', big ? 22 : 18));
  btn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    btn.disabled = true;
    try {
      if (product.isFavourite) await del(`/api/favourites/${product.id}`); else await put(`/api/favourites/${product.id}`);
      product.isFavourite = !product.isFavourite;
      btn.classList.toggle('on', product.isFavourite);
      btn.setAttribute('aria-pressed', String(product.isFavourite));
      toast(product.isFavourite ? 'Saved to your wishlist' : 'Removed from your wishlist');
      onChange?.(product.isFavourite);
      refreshBadges();
    } catch (err) { toast(errorText(err), 'error'); }
    btn.disabled = false;
  });
  return btn;
}

export function shoeCard(p, user, { onHeart } = {}) {
  const sale = p.onSale ? h('span', { class: 'tag' }, `-${p.discountPercent}%`) : null;
  const sold = !p.inStock ? h('span', { class: 'tag dark' }, 'Sold out') : null;
  return h('article', { class: 'shoe' },
    h('a', { class: 'shoe-tile', href: `/product.html?id=${p.id}`, 'aria-label': p.name }, shoeImg(p), sale, sold, heartButton(p, user, { onChange: onHeart })),
    h('a', { href: `/product.html?id=${p.id}` }, h('div', { class: 'shoe-name' }, p.name), h('div', { class: 'shoe-type' }, `${p.brand}, ${p.type.toLowerCase()}`)),
    h('div', { class: 'shoe-foot' }, h('span', { class: 'price' }, money(p.price), p.onSale ? h('s', {}, money(p.oldPrice)) : null), p.reviewCount ? stars(p.avgRating) : null));
}

// ---------------------------------------------------------------- the page shell
let badgeTargets = {};
export async function refreshBadges() {
  try {
    const s = await get('/api/summary');
    if (badgeTargets.cart) { badgeTargets.cart.textContent = s.cartCount; badgeTargets.cart.hidden = s.cartCount === 0; }
    if (badgeTargets.dot) badgeTargets.dot.hidden = s.unreadCount === 0;
    return s;
  } catch { return null; }
}

export async function mountShell({ page, dark = false }) {
  document.body.dataset.page = page;
  document.body.classList.toggle('dark', dark);
  const main = $('#app');
  const { user } = await get('/api/me').catch(() => ({ user: null }));
  const cartBadge = h('span', { class: 'badge', hidden: true }, '0');
  const dot = h('span', { class: 'dot', hidden: true });
  badgeTargets = { cart: cartBadge, dot };

  const link = (href, label, key) => h('a', { href, 'aria-current': page === key ? 'page' : null }, label);
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, link('/', 'Shop', 'shop'), link('/favourites.html', 'Wishlist', 'favourites'), link('/notifications.html', 'Alerts', 'notifications'), link('/orders.html', 'Orders', 'orders'));
  const right = user
    ? [h('a', { class: 'iconbtn', href: '/cart.html', 'aria-label': 'Cart' }, icon('bag'), cartBadge),
       h('a', { class: 'avatar', href: '/profile.html', 'aria-label': 'Your profile' }, initials(user.fullName))]
    : [h('a', { class: 'btn sm', href: `/login.html?next=${encodeURIComponent(location.pathname + location.search)}` }, 'Log in')];
  const topbar = h('header', { class: 'topbar' }, h('div', { class: 'wrap topbar-in' }, h('a', { class: 'brand', href: '/' }, 'Shushop'), nav, h('span', { class: 'grow' }), ...right));
  document.body.prepend(topbar);

  const tab = (href, name, label, key, extra) => h('a', { class: 'tab', href, 'aria-label': label, 'aria-current': page === key ? 'page' : null }, icon(name), extra);
  document.body.append(h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    tab('/', 'home', 'Shop', 'shop'), tab('/notifications.html', 'bell', 'Alerts', 'notifications', dot),
    tab('/favourites.html', 'heart', 'Wishlist', 'favourites'), tab(user ? '/profile.html' : '/login.html', 'user', 'Profile', 'profile')));

  let summary = null;
  if (user) summary = await refreshBadges();
  return { user, summary, main };
}

// Shop admin: one page, six tabs. Everything here goes through /api/admin/*, which the server only opens to the admin role.
// Changes show up for customers (website and app) straight away because both read the same database.
import { get, post, put, patch, del } from '../api.js';
import { mountShell, h, icon, clear, money, plural, fmtDate, fmtDateTime, statusChip, STATUS_LABEL, PAYMENT_LABEL, errorText, toast, openSheet, confirmSheet, empty, itemImg, shoeImg, debounce } from '../ui.js';

const { user, main } = await mountShell({ page: 'admin' });
document.title = 'Shop admin - Shushop';

if (!user) {
  location.replace(`/login.html?next=${encodeURIComponent('/admin.html')}`);
  throw new Error('login needed');
}
if (user.role !== 'admin') {
  main.append(empty({ title: 'This page is for the shop owner', text: 'Your account is a customer account.', action: { href: '/', label: 'Back to the shop' } }));
  throw new Error('not an admin');
}

const TABS = [['overview', 'Overview'], ['orders', 'Orders'], ['shoes', 'Shoes'], ['coupons', 'Coupons'], ['customers', 'Customers'], ['announce', 'Announce']];
const STYLES = [['court', 'Court'], ['runner', 'Runner'], ['high', 'High-top'], ['chunky', 'Chunky'], ['slip', 'Slip-on'], ['boot', 'Boot']];
const CATEGORIES = [['men', 'Men'], ['women', 'Women'], ['kids', 'Kids'], ['unisex', 'Unisex']];
const NEXT = { new: ['processing', 'Start packing'], processing: ['shipped', 'Send out'], shipped: ['delivered', 'Mark delivered'] };

let current = TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
const tabsBox = h('div', { class: 'chips admin-tabs', role: 'tablist', 'aria-label': 'Admin sections' });
const body = h('div', { class: 'admin-body' });
main.append(h('div', { class: 'row between', style: { margin: '6px 0 4px' } }, h('h1', {}, 'Shop admin'), h('a', { class: 'link small', href: '/' }, 'View the shop')), tabsBox, body);

function drawTabs() {
  clear(tabsBox);
  for (const [key, label] of TABS) {
    tabsBox.append(h('button', {
      class: `chip ${key === current ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(key === current),
      onclick: () => { current = key; history.replaceState(null, '', `#${key}`); drawTabs(); show(); },
    }, label));
  }
}

let token = 0;                                  // ignore answers that arrive after the person switched tab
async function show() {
  const mine = ++token;
  clear(body).append(h('p', { class: 'muted' }, 'Loading...'));
  try {
    const view = await ({ overview, orders, shoes, coupons, customers, announce }[current])();
    if (mine === token) clear(body).append(view);
  } catch (e) {
    if (mine === token) clear(body).append(h('p', { class: 'error-text', role: 'alert' }, errorText(e)));
  }
}

const th = (...labels) => h('tr', {}, labels.map((l) => h('th', { class: l.startsWith('>') ? 'num' : null }, l.replace(/^>/, ''))));
const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, head), h('tbody', {}, rows)));

// ================================================================ overview
async function overview() {
  const s = await get('/api/admin/stats');
  const max = Math.max(1, ...s.last7Days.map((d) => d.revenue));
  const dayName = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
  const kpi = (value, label, wide) => h('div', { class: `kpi ${wide ? 'wide' : ''}` }, h('b', {}, value), h('span', {}, label));
  return h('div', { class: 'stack', style: { gap: '26px' } },
    h('div', { class: 'kpis' },
      kpi(money(s.revenue), 'Sales, all time', true), kpi(money(s.revenue7d), 'Sales, last 7 days', true),
      kpi(String(s.ordersToday), 'Orders today'), kpi(String(s.ordersTotal), 'Orders, all time'),
      kpi(String(s.customers), 'Customers'), kpi(String(s.products), 'Shoes on sale'),
      kpi(String(s.soldOutVariants), 'Sizes sold out'), kpi(String(s.ordersByStatus.new), 'New orders to handle')),
    h('section', {}, h('h2', { style: { marginBottom: '8px' } }, 'Sales in the last 7 days'),
      h('div', { class: 'chart', role: 'img', 'aria-label': `Daily sales: ${s.last7Days.map((d) => `${dayName(d.day)} ${money(d.revenue)}`).join(', ')}` },
        s.last7Days.map((d) => h('div', { title: `${money(d.revenue)}, ${plural(d.orders, 'order')}` }, h('i', { style: { '--h': String(Math.max(3, Math.round((d.revenue / max) * 100))) } }), dayName(d.day))))),
    h('div', { class: 'split' },
      h('section', {}, h('h2', {}, 'Orders by status'), h('div', { class: 'mini-list' },
        Object.entries(s.ordersByStatus).map(([k, n]) => h('div', {}, statusChip(k), h('b', {}, String(n)))))),
      h('section', {}, h('h2', {}, 'Best sellers'),
        s.topProducts.length ? h('div', { class: 'mini-list' }, s.topProducts.map((p) => h('div', {}, h('span', {}, p.name), h('span', { class: 'muted small' }, `${plural(p.units, 'pair')}, ${money(p.revenue)}`))))
          : h('p', { class: 'muted' }, 'Nothing sold yet.'))),
    h('section', {}, h('h2', {}, 'Running low'),
      s.lowStock.length ? h('div', { class: 'mini-list' }, s.lowStock.map((v) => h('div', {},
        h('span', {}, `${v.name}, size ${v.size}, ${v.colorName}`),
        h('span', { class: 'row-actions' }, h('span', { class: 'pill' }, `${v.stock} left`), h('button', { class: 'btn quiet sm', type: 'button', onclick: () => openStock(v.productId) }, 'Restock')))))
        : h('p', { class: 'muted' }, 'Every size has three or more pairs, or is already sold out.')));
}

// ================================================================ orders
let orderFilter = '';
async function orders() {
  const wrap = h('div', { class: 'stack' });
  const list = h('div');
  const filters = h('div', { class: 'chips' });
  const drawFilters = () => {
    clear(filters);
    for (const [k, label] of [['', 'All'], ...Object.entries(STATUS_LABEL)]) {
      filters.append(h('button', { class: `chip ${orderFilter === k ? 'on' : ''}`, type: 'button', onclick: () => { orderFilter = k; drawFilters(); load(); } }, label));
    }
  };
  async function load() {
    const { orders: rows } = await get(`/api/admin/orders${orderFilter ? `?status=${orderFilter}` : ''}`);
    clear(list);
    if (!rows.length) { list.append(h('p', { class: 'muted' }, 'No orders here yet.')); return; }
    list.append(table(th('Order', 'Customer', 'Placed', '>Total', 'Status', ''), rows.map((o) => h('tr', {},
      h('td', {}, h('button', { class: 'link', type: 'button', onclick: () => openOrder(o.id, load) }, `#${o.id}`)),
      h('td', {}, h('div', {}, o.customer.name), h('div', { class: 'muted small' }, plural(o.itemCount, 'pair'))),
      h('td', { class: 'muted' }, fmtDateTime(o.createdAt)),
      h('td', { class: 'num' }, money(o.total)),
      h('td', {}, statusChip(o.status)),
      h('td', {}, orderActions(o, load))))));
  }
  wrap.append(filters, list);
  drawFilters();
  await load();
  return wrap;
}

function orderActions(o, reload, { close } = {}) {
  const set = async (status, ask) => {
    if (ask && !(await confirmSheet({ title: `Cancel order #${o.id}?`, text: 'The customer is told, and the pairs go back into stock.', confirm: 'Cancel order', danger: true }))) return;
    try { await patch(`/api/admin/orders/${o.id}/status`, { status }); toast(`Order #${o.id}: ${STATUS_LABEL[status].toLowerCase()}`); close?.(); await reload(); } catch (e) { toast(errorText(e), 'error'); }
  };
  const next = NEXT[o.status];
  const cancellable = ['new', 'processing', 'shipped'].includes(o.status);
  return h('div', { class: 'row-actions' },
    next ? h('button', { class: 'btn sm', type: 'button', onclick: () => set(next[0]) }, next[1]) : null,
    cancellable ? h('button', { class: 'btn danger sm', type: 'button', onclick: () => set('cancelled', true) }, 'Cancel') : null);
}

async function openOrder(id, reload) {
  let order;
  try { order = (await get(`/api/admin/orders/${id}`)).order; } catch (e) { toast(errorText(e), 'error'); return; }
  const box = h('div', { class: 'stack' });
  const sheet = openSheet(`Order #${order.id}`, box);
  box.append(
    h('div', { class: 'row between' }, statusChip(order.status), h('span', { class: 'muted small' }, `Placed ${fmtDateTime(order.createdAt)}`)),
    h('div', {}, h('b', {}, order.customer.name), h('div', { class: 'muted small' }, order.customer.email)),
    h('div', { class: 'stack', style: { gap: '10px' } }, order.items.map((i) => h('div', { class: 'row' },
      h('span', { style: { width: '56px', flex: '0 0 56px' } }, itemImg(i)),
      h('div', { class: 'grow' }, h('b', {}, i.name), h('div', { class: 'muted small' }, `${i.colorName}, size ${i.size}`)),
      h('div', { style: { textAlign: 'right' } }, h('div', {}, money(i.unitPrice * i.qty)), h('div', { class: 'muted small' }, `${i.qty} x ${money(i.unitPrice)}`))))),
    h('div', { class: 'mini-list' },
      h('div', {}, h('span', { class: 'muted' }, 'Items'), money(order.subtotal)),
      h('div', {}, h('span', { class: 'muted' }, 'Delivery'), money(order.shippingFee)),
      order.discount ? h('div', {}, h('span', { class: 'muted' }, `Coupon ${order.couponCode || ''}`), `-${money(order.discount)}`) : null,
      h('div', {}, h('b', {}, 'Total'), h('b', {}, money(order.total)))),
    h('div', {}, h('b', {}, 'Deliver to'), h('div', {}, `${order.addressLine}, ${order.city}`), h('div', { class: 'muted' }, order.phone), h('div', { class: 'muted small' }, `Pays: ${PAYMENT_LABEL[order.paymentMethod] || order.paymentMethod}`)),
    h('div', {}, h('b', {}, 'History'), h('div', { class: 'mini-list' }, (order.history || []).map((x) => h('div', {}, statusChip(x.status), h('span', { class: 'muted small' }, fmtDateTime(x.at)))))),
    orderActions(order, reload, { close: sheet.close }));
}

// ================================================================ shoes
async function shoes() {
  const { products } = await get('/api/admin/products');
  const wrap = h('div', { class: 'stack' });
  const reload = async () => { clear(body).append(await shoes()); };
  wrap.append(h('div', { class: 'row between' }, h('p', { class: 'muted' }, `${plural(products.length, 'shoe')} in the catalogue`), h('button', { class: 'btn sm', type: 'button', onclick: () => shoeForm(null, reload) }, icon('plus', 18), 'Add a shoe')));
  wrap.append(table(th('', 'Shoe', '>Price', '>In stock', 'Shown', ''), products.map((p) => h('tr', {},
    h('td', {}, h('span', { style: { display: 'block', width: '56px' } }, shoeImg(p))),
    h('td', {}, h('b', {}, p.name), h('div', { class: 'muted small' }, `${p.brand}, ${p.category}`)),
    h('td', { class: 'num' }, money(p.price), p.onSale ? h('div', { class: 'muted small' }, `was ${money(p.oldPrice)}`) : null),
    h('td', { class: 'num' }, p.totalStock === 0 ? h('span', { class: 'pill' }, 'Sold out') : String(p.totalStock)),
    h('td', {}, p.isActive ? 'Yes' : h('span', { class: 'muted' }, 'Hidden')),
    h('td', {}, h('div', { class: 'row-actions' },
      h('button', { class: 'btn quiet sm', type: 'button', onclick: () => openStock(p.id, reload) }, 'Stock'),
      h('button', { class: 'btn quiet sm', type: 'button', onclick: () => shoeForm(p, reload) }, 'Edit'),
      h('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Delete ${p.name}`, onclick: () => removeShoe(p, reload) }, icon('trash', 18))))))));
  return wrap;
}

async function removeShoe(p, reload) {
  const ok = await confirmSheet({ title: `Delete ${p.name}?`, text: 'It disappears from the shop and from carts and wishlists. Past orders keep their own copy, so order history stays complete. To only hide it, use Edit instead.', confirm: 'Delete shoe', danger: true });
  if (!ok) return;
  try { await del(`/api/admin/products/${p.id}`); toast('Shoe deleted'); await reload(); } catch (e) { toast(errorText(e), 'error'); }
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
const select = (options, value) => h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

function shoeForm(p, reload) {
  const f = {
    name: h('input', { class: 'input', value: p?.name || '', required: true, minlength: 2, maxlength: 80 }),
    brand: h('input', { class: 'input', value: p?.brand || '', required: true, minlength: 2, maxlength: 40, list: 'brands-list' }),
    type: h('input', { class: 'input', value: p?.type || 'Sneakers', required: true, maxlength: 30 }),
    category: select(CATEGORIES, p?.category || 'unisex'),
    price: h('input', { class: 'input', type: 'number', min: 1000, step: 1000, value: p?.price ?? '', required: true, inputmode: 'numeric' }),
    oldPrice: h('input', { class: 'input', type: 'number', min: 1000, step: 1000, value: p?.oldPrice ?? '', inputmode: 'numeric' }),
    artStyle: select(STYLES, p?.artStyle || 'court'),
    imageUrl: h('input', { class: 'input', type: 'url', value: p?.imageUrl || '', placeholder: 'https://...' }),
    description: h('textarea', { class: 'input', maxlength: 1000, rows: 3, style: { height: 'auto', padding: '14px 16px' } }),
    isActive: h('input', { type: 'checkbox', checked: p ? p.isActive : true }),
  };
  f.description.value = p?.description || '';
  const brands = h('datalist', { id: 'brands-list' }, ['Kora', 'Velo', 'Nomad', 'Atlas', 'Lume'].map((b) => h('option', { value: b })));

  // a new shoe starts with a grid of sizes and colours; the Stock sheet fine-tunes it afterwards
  const sizes = h('input', { class: 'input', value: '39, 40, 41, 42, 43, 44', placeholder: '39-44 or 39, 40, 41' });
  const startStock = h('input', { class: 'input', type: 'number', min: 0, max: 1000, value: 5, inputmode: 'numeric' });
  const colorRows = h('div', { class: 'stack', style: { gap: '8px' } });
  const addColor = (name = '', hex = '#1b1b1d') => {
    const row = h('div', { class: 'row' },
      h('input', { class: 'input', placeholder: 'Colour name', value: name, maxlength: 30, 'aria-label': 'Colour name' }),
      h('input', { type: 'color', value: hex, 'aria-label': 'Colour', style: { width: '52px', height: '50px', border: '0', background: 'none', padding: '0', flex: '0 0 52px' } }),
      h('button', { class: 'iconbtn sm', type: 'button', 'aria-label': 'Remove colour', onclick: () => row.remove() }, icon('x', 18)));
    colorRows.append(row);
  };
  addColor('Black', '#1b1b1d'); addColor('Cloud', '#e6e2da');

  const msg = h('div', { class: 'error-text', role: 'alert' });
  const parseSizes = (text) => {
    const out = new Set();
    for (const part of text.split(/[,\s]+/).filter(Boolean)) {
      const range = part.match(/^(\d{2})-(\d{2})$/);
      if (range) { for (let s = Number(range[1]); s <= Number(range[2]); s++) out.add(s); } else if (/^\d{2}$/.test(part)) out.add(Number(part)); else throw new Error(`"${part}" is not a size`);
    }
    return [...out].sort((a, b) => a - b);
  };
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    const payload = {
      name: f.name.value, brand: f.brand.value, type: f.type.value, category: f.category.value, description: f.description.value,
      price: Number(f.price.value), oldPrice: f.oldPrice.value === '' ? null : Number(f.oldPrice.value),
      artStyle: f.artStyle.value, imageUrl: f.imageUrl.value.trim() || null, isActive: f.isActive.checked,
    };
    try {
      if (!p) {
        const colours = [...colorRows.children].map((r) => ({ name: r.children[0].value.trim(), hex: r.children[1].value })).filter((c) => c.name);
        const list = parseSizes(sizes.value);
        if (!colours.length || !list.length) throw new Error('Add at least one size and one colour.');
        payload.variants = colours.flatMap((c) => list.map((size) => ({ size, colorName: c.name, colorHex: c.hex, stock: Number(startStock.value) || 0 })));
      }
      await (p ? put(`/api/admin/products/${p.id}`, payload) : post('/api/admin/products', payload));
      sheet.close(); toast(p ? 'Shoe saved' : 'Shoe added to the shop'); await reload();
    } catch (err) { msg.textContent = err.message && !err.status ? err.message : errorText(err); }
  } },
    field('Name', f.name), h('div', { class: 'two' }, field('Brand', f.brand), field('Type', f.type)), brands,
    h('div', { class: 'two' }, field('Category', f.category), field('Picture style', f.artStyle, 'Used when there is no photo.')),
    h('div', { class: 'two' }, field('Price (so\'m)', f.price), field('Old price (so\'m)', f.oldPrice, 'Fills the sale badge.')),
    field('Photo link', f.imageUrl, 'Optional. A https:// address. Without it the shop draws the shoe.'),
    field('Description', f.description),
    h('label', { class: 'check' }, f.isActive, 'Show in the shop'),
    p ? h('p', { class: 'hint' }, 'Sizes and stock are on the Stock sheet.') : h('div', { class: 'stack' },
      h('h3', {}, 'Sizes and colours'),
      field('Sizes (EU)', sizes, 'Ranges and lists both work, like 38-42 or 39, 41.'),
      field('Pairs per size to start with', startStock),
      h('div', { class: 'label' }, 'Colours'), colorRows,
      h('button', { class: 'btn quiet sm', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => addColor('', '#888888') }, icon('plus', 16), 'Another colour')),
    msg, h('button', { class: 'btn', type: 'submit' }, p ? 'Save changes' : 'Add shoe'));
  const sheet = openSheet(p ? `Edit ${p.name}` : 'Add a shoe', form);
}

async function openStock(productId, reload) {
  let product;
  try { product = (await get(`/api/admin/products/${productId}`)).product; } catch (e) { toast(errorText(e), 'error'); return; }
  const box = h('div');
  let changed = false;
  openSheet(`Stock: ${product.name}`, box, { onClose: () => { if (changed) (reload || show)(); } });

  function draw() {
    clear(box);
    const groups = new Map();
    for (const v of product.variants) groups.set(v.colorName, [...(groups.get(v.colorName) || []), v]);
    if (!groups.size) box.append(h('p', { class: 'muted' }, 'No sizes yet. Add the first one below.'));
    for (const [colour, list] of groups) {
      box.append(h('div', { class: 'group-title' }, h('span', { class: 'swatch', style: { '--c': list[0].colorHex } }), colour,
        h('span', { class: 'muted small' }, plural(list.reduce((n, v) => n + v.stock, 0), 'pair'))));
      box.append(h('div', { class: 'stock-grid' }, list.map((v) => {
        const input = h('input', { class: 'input', type: 'number', min: 0, max: 1000, value: v.stock, inputmode: 'numeric', 'aria-label': `Pairs in size ${v.size}, ${colour}` });
        const cell = h('div', { class: `stock-cell ${v.stock === 0 ? 'zero' : ''}` },
          h('div', { class: 'row between' }, h('b', {}, `Size ${v.size}`),
            h('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Remove size ${v.size}, ${colour}`, onclick: async () => {
              if (!(await confirmSheet({ title: `Remove size ${v.size}?`, text: `${colour}, size ${v.size} leaves the shop and carts.`, confirm: 'Remove', danger: true }))) return;
              try { await del(`/api/admin/variants/${v.id}`); product.variants = product.variants.filter((x) => x.id !== v.id); changed = true; draw(); } catch (e) { toast(errorText(e), 'error'); }
            } }, icon('x', 14))),
          input);
        input.addEventListener('change', debounce(async () => {
          try {
            const r = await put(`/api/admin/variants/${v.id}`, { stock: Number(input.value) });
            v.stock = r.stock; changed = true; cell.classList.toggle('zero', v.stock === 0);
            toast(r.notified ? `Saved. ${plural(r.notified, 'customer')} told it is back.` : 'Stock saved');
          } catch (e) { toast(errorText(e), 'error'); input.value = v.stock; }
        }, 150));
        return cell;
      })));
    }
    box.append(addVariant());
  }

  function addVariant() {
    const size = h('input', { class: 'input', type: 'number', min: 16, max: 50, required: true, placeholder: '41', inputmode: 'numeric' });
    const existing = [...new Map(product.variants.map((v) => [v.colorName, v.colorHex])).entries()];
    const colour = h('input', { class: 'input', required: true, maxlength: 30, list: 'colour-list', placeholder: existing[0]?.[0] || 'Black' });
    const hex = h('input', { type: 'color', value: existing[0]?.[1] || '#1b1b1d', 'aria-label': 'Colour', style: { width: '52px', height: '50px', border: '0', background: 'none', padding: '0' } });
    const stock = h('input', { class: 'input', type: 'number', min: 0, max: 1000, value: 5, inputmode: 'numeric' });
    colour.addEventListener('input', () => { const m = existing.find(([n]) => n.toLowerCase() === colour.value.trim().toLowerCase()); if (m) hex.value = m[1]; });
    const msg = h('div', { class: 'error-text', role: 'alert' });
    return h('form', { class: 'form', style: { marginTop: '22px' }, onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = '';
      try {
        const { variant } = await post(`/api/admin/products/${productId}/variants`, { size: Number(size.value), colorName: colour.value, colorHex: hex.value, stock: Number(stock.value) });
        product.variants.push(variant); product.variants.sort((a, b) => a.colorName.localeCompare(b.colorName) || a.size - b.size); changed = true; draw(); toast('Size added');
      } catch (err) { msg.textContent = errorText(err); }
    } }, h('h3', {}, 'Add a size'),
      h('datalist', { id: 'colour-list' }, existing.map(([n]) => h('option', { value: n }))),
      h('div', { class: 'two' }, field('Size (EU)', size), field('Pairs', stock)),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Colour', colour)), hex),
      msg, h('button', { class: 'btn quiet', type: 'submit' }, 'Add size'));
  }
  draw();
}

// ================================================================ coupons
async function coupons() {
  const { coupons: rows } = await get('/api/admin/coupons');
  const reload = async () => { clear(body).append(await coupons()); };
  const code = h('input', { class: 'input', required: true, maxlength: 20, placeholder: 'SUMMER20', style: { textTransform: 'uppercase' }, 'aria-label': 'Coupon code' });
  const percent = h('input', { class: 'input', type: 'number', min: 1, max: 90, required: true, placeholder: '10', inputmode: 'numeric', 'aria-label': 'Percent off' });
  const minTotal = h('input', { class: 'input', type: 'number', min: 0, step: 1000, placeholder: '0', inputmode: 'numeric', 'aria-label': 'Minimum order' });
  const msg = h('div', { class: 'error-text', role: 'alert' });
  return h('div', { class: 'stack', style: { gap: '26px' } },
    rows.length ? table(th('Code', '>Off', '>Minimum order', 'On', ''), rows.map((c) => h('tr', {},
      h('td', {}, h('b', {}, c.code)), h('td', { class: 'num' }, `${c.percent}%`), h('td', { class: 'num' }, c.minTotal ? money(c.minTotal) : 'None'),
      h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.active, 'aria-label': `${c.code} is on`, onchange: async (e) => {
        try { await patch(`/api/admin/coupons/${c.code}`, { active: e.target.checked }); toast(e.target.checked ? `${c.code} is on` : `${c.code} is off`); } catch (err) { e.target.checked = !e.target.checked; toast(errorText(err), 'error'); }
      } }))),
      h('td', {}, h('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Delete ${c.code}`, onclick: async () => {
        if (!(await confirmSheet({ title: `Delete ${c.code}?`, text: 'Customers can no longer use this code. Past orders keep their discount.', confirm: 'Delete coupon', danger: true }))) return;
        try { await del(`/api/admin/coupons/${c.code}`); await reload(); } catch (err) { toast(errorText(err), 'error'); }
      } }, icon('trash', 18)))))) : h('p', { class: 'muted' }, 'No coupons yet.'),
    h('form', { class: 'panel form', onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = '';
      try { await post('/api/admin/coupons', { code: code.value, percent: Number(percent.value), minTotal: Number(minTotal.value) || 0 }); toast('Coupon added'); await reload(); } catch (err) { msg.textContent = errorText(err); }
    } }, h('h3', {}, 'New coupon'), h('div', { class: 'two' }, field('Code', code), field('Percent off', percent)), field('Minimum order (so\'m)', minTotal, 'Leave empty for no minimum.'), msg, h('button', { class: 'btn', type: 'submit' }, 'Add coupon')));
}

// ================================================================ customers
async function customers() {
  const { customers: rows } = await get('/api/admin/customers');
  if (!rows.length) return h('p', { class: 'muted' }, 'No customers yet.');
  return table(th('Customer', 'Phone', '>Orders', '>Spent', 'Joined'), rows.map((c) => h('tr', {},
    h('td', {}, h('b', {}, c.name), h('div', { class: 'muted small' }, c.email)), h('td', { class: 'muted' }, c.phone || '-'),
    h('td', { class: 'num' }, String(c.orders)), h('td', { class: 'num' }, money(c.spent)), h('td', { class: 'muted' }, fmtDate(c.memberSince)))));
}

// ================================================================ announce a drop
async function announce() {
  const { products } = await get('/api/admin/products');
  const title = h('input', { class: 'input', value: 'New drop alert', maxlength: 60, required: true });
  const text = h('textarea', { class: 'input', maxlength: 200, required: true, rows: 3, placeholder: 'The Urban Step is now in the shop.', style: { height: 'auto', padding: '14px 16px' } });
  const shoe = h('select', { class: 'input' }, h('option', { value: '' }, 'No shoe, just a message'), products.filter((p) => p.isActive).map((p) => h('option', { value: p.id }, `${p.name}, ${p.brand}`)));
  const msg = h('div', { class: 'error-text', role: 'alert' });
  return h('form', { class: 'panel form', style: { maxWidth: '560px' }, onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    if (!(await confirmSheet({ title: 'Send to every customer?', text: 'They get it as a notification in the website and the app. It cannot be taken back.', confirm: 'Send it' }))) return;
    try { const r = await post('/api/admin/announce', { title: title.value, body: text.value, productId: shoe.value ? Number(shoe.value) : null }); toast(`Sent to ${plural(r.sent, 'customer')}`); text.value = ''; } catch (err) { msg.textContent = errorText(err); }
  } }, h('h3', {}, 'Tell customers about a new drop'),
    field('Title', title), field('Message', text), field('Link it to a shoe', shoe, 'Tapping the notification then opens that shoe.'), msg, h('button', { class: 'btn', type: 'submit' }, 'Send to customers'));
}

addEventListener('hashchange', () => {            // back/forward buttons and links like /admin.html#orders
  const key = location.hash.slice(1);
  if (TABS.some(([k]) => k === key) && key !== current) { current = key; drawTabs(); show(); }
});
drawTabs();
await show();

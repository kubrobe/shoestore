import { get } from '../api.js';
import { mountShell, h, icon, clear, shoeCard, openSheet, empty, skeletonGrid, debounce, errorText, money, plural } from '../ui.js';

const { user, main } = await mountShell({ page: 'shop' });
const meta = await get('/api/meta').catch(() => null);
const PAGE = 12;

// The filters live in the address bar, so the back button and shared links keep working.
const q = new URLSearchParams(location.search);
const state = {
  search: q.get('search') || '', category: q.get('category') || '', brand: q.get('brand') || '', size: q.get('size') || '',
  min: q.get('min') || '', max: q.get('max') || '', sort: q.get('sort') || 'popular',
};
const CATEGORY_CHIPS = [['', 'All shoes'], ['men', 'Men'], ['women', 'Women'], ['kids', 'Kids'], ['sale', 'Sale']];
const SORT_LABEL = { popular: 'Most popular', newest: 'Newest', price_asc: 'Price, low to high', price_desc: 'Price, high to low', rating: 'Best rated' };

const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Search for shoes', 'aria-label': 'Search for shoes', value: state.search, autocomplete: 'off', maxlength: 60 });
const filterBtn = h('button', { class: 'iconbtn ink', type: 'button', 'aria-label': 'Filters', style: { width: '52px', height: '52px', borderRadius: '16px' }, onclick: openFilters }, icon('sliders'));
const chipsBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Category' });
const info = h('div', { class: 'row between small muted' });
const results = h('div');
const moreBox = h('div', { class: 'more' });

main.append(
  meta ? h('div', { class: 'notice' }, h('b', {}, 'Free delivery'), ` on orders over ${money(meta.freeShippingFrom)}. Otherwise delivery is ${money(meta.shippingFee)}.`) : null,
  h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search', 20), searchInput), filterBtn),
  chipsBox, info, results, moreBox);

function drawChips() {
  clear(chipsBox);
  for (const [value, label] of CATEGORY_CHIPS) {
    chipsBox.append(h('button', { class: `chip ${state.category === value ? 'on' : ''}`, type: 'button', 'aria-pressed': String(state.category === value), onclick: () => { state.category = value; reload(); } }, label));
  }
}

function writeUrl() {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v && !(k === 'sort' && v === 'popular')) u.set(k, v);
  history.replaceState(null, '', u.toString() ? `/?${u}` : '/');
}

let offset = 0;
let token = 0;
async function load(reset) {
  const mine = ++token;
  if (reset) { offset = 0; clear(results); results.append(skeletonGrid(8)); clear(moreBox); }
  const u = new URLSearchParams({ limit: PAGE, offset, sort: state.sort });
  for (const k of ['search', 'category', 'brand', 'size', 'min', 'max']) if (state[k]) u.set(k, state[k]);
  let data;
  try { data = await get(`/api/products?${u}`); } catch (e) {
    if (mine !== token) return;
    clear(results).append(empty({ title: 'The shop did not load', text: errorText(e), art: false }));
    return;
  }
  if (mine !== token) return;                      // an older request finished late; ignore it
  if (reset) clear(results);
  let grid = results.querySelector('.grid');
  if (!grid) { grid = h('div', { class: 'grid' }); results.append(grid); }
  for (const p of data.products) grid.append(shoeCard(p, user));
  offset += data.products.length;
  clear(info).append(h('span', {}, plural(data.total, 'shoe')), activeFilters() ? h('button', { class: 'link', type: 'button', onclick: resetFilters }, 'Clear filters') : null);
  clear(moreBox);
  if (data.total === 0) {
    clear(results).append(empty({ title: 'No shoes match', text: 'Try a different word, or remove a filter.' }));
  } else if (offset < data.total) {
    moreBox.append(h('button', { class: 'btn line', type: 'button', onclick: () => load(false) }, `Show more (${data.total - offset} left)`));
  }
}

const activeFilters = () => !!(state.search || state.category || state.brand || state.size || state.min || state.max);
function resetFilters() { Object.assign(state, { search: '', category: '', brand: '', size: '', min: '', max: '', sort: 'popular' }); searchInput.value = ''; reload(); }
function reload() { drawChips(); writeUrl(); load(true); }

searchInput.addEventListener('input', debounce(() => { state.search = searchInput.value.trim(); reload(); }, 300));

function openFilters() {
  const draft = { ...state };
  const brandBox = h('div', { class: 'chips' });
  const sizeBox = h('div', { class: 'chips' });
  const drawBrands = () => { clear(brandBox); for (const b of ['', ...(meta?.brands || [])]) brandBox.append(h('button', { class: `chip ${draft.brand === b ? 'on' : ''}`, type: 'button', onclick: () => { draft.brand = b; drawBrands(); } }, b || 'All brands')); };
  const sizes = []; for (let s = meta?.sizeRange.min ?? 27; s <= (meta?.sizeRange.max ?? 46); s++) sizes.push(String(s));
  const drawSizes = () => { clear(sizeBox); for (const s of ['', ...sizes]) sizeBox.append(h('button', { class: `chip ${draft.size === s ? 'on' : ''}`, type: 'button', onclick: () => { draft.size = s; drawSizes(); } }, s || 'Any size')); };
  drawBrands(); drawSizes();
  const min = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, step: 10000, placeholder: 'From', value: draft.min, 'aria-label': 'Lowest price' });
  const max = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: 0, step: 10000, placeholder: 'To', value: draft.max, 'aria-label': 'Highest price' });
  const sort = h('select', { class: 'input', 'aria-label': 'Sort by' }, Object.entries(SORT_LABEL).map(([v, l]) => h('option', { value: v, selected: draft.sort === v }, l)));
  const { close } = openSheet('Filters', h('div', { class: 'form' },
    h('div', { class: 'field' }, h('span', {}, 'Sort by'), sort),
    h('div', { class: 'field' }, h('span', {}, 'Brand'), brandBox),
    h('div', { class: 'field' }, h('span', {}, 'Size (EU)'), sizeBox),
    h('div', { class: 'field' }, h('span', {}, `Price in ${meta?.currency || "so'm"}`), h('div', { class: 'two' }, min, max)),
    h('div', { class: 'sheet-foot' },
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { Object.assign(state, { brand: '', size: '', min: '', max: '', sort: 'popular' }); close(); reload(); } }, 'Reset'),
      h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(state, { brand: draft.brand, size: draft.size, min: min.value, max: max.value, sort: sort.value }); close(); reload(); } }, 'Show results'))));
}

reload();

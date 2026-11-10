import { get } from '../api.js';
import {mountShell, h, clear, shoeCard, empty, requireLogin, errorText} from '../ui.js';

const { user, main } = await mountShell({ page: 'favourites' });
if (!requireLogin(user)) throw new Error('login needed');
document.title = 'Wishlist - Shushop';

const title = h('h1', {});
const grid = h('div', { class: 'grid' });
main.append(h('div', { class: 'page-head' }, title), grid);

let count = 0;
function setCount() {
  title.textContent = count ? `Wishlist (${count})` : 'Wishlist';
  if (count === 0) clear(grid).append(empty({ title: 'Nothing saved yet', text: 'Tap the heart on a shoe to keep it here. We also tell you when a saved pair drops in price or comes back in stock.', action: { href: '/', label: 'Browse shoes' } }));
}

try {
  const { products } = await get('/api/favourites');
  count = products.length;
  setCount();
  for (const p of products) {
    const card = shoeCard(p, user, { onHeart: (on) => { if (!on) { card.remove(); count--; setCount(); } } });
    grid.append(card);
  }
} catch (e) { clear(grid).append(empty({ title: 'Wishlist did not load', text: errorText(e), art: false })); }

import { get, post } from '../api.js';
import { mountShell, h, icon, clear, timeAgo, empty, requireLogin, errorText, refreshBadges, toast } from '../ui.js';

const { user, main } = await mountShell({ page: 'notifications', dark: true });
if (!requireLogin(user)) throw new Error('login needed');
document.title = 'Notifications - Shushop';

const FILTERS = [['all', 'All'], ['price_drop', 'Price drops'], ['restock', 'Restocks'], ['order', 'Orders'], ['drop', 'New drops']];
const ICON = { price_drop: 'tag', restock: 'restock', order: 'box', drop: 'bolt' };
let filter = 'all';
let data = { notifications: [], unreadCount: 0 };

const subtitle = h('div', { class: 'small muted' });
const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter notifications' });
const list = h('div', { class: 'notes' });
const markAll = h('button', { class: 'iconbtn solid', type: 'button', 'aria-label': 'Mark everything as read', title: 'Mark everything as read', onclick: async () => {
  try { await post('/api/notifications/read-all'); data.notifications.forEach((n) => { n.isRead = true; }); data.unreadCount = 0; draw(); refreshBadges(); toast('All caught up'); } catch (e) { toast(errorText(e), 'error'); }
} }, icon('check'));

main.append(h('div', { class: 'page-head' }, h('div', { class: 'stack', style: { gap: '2px', flex: 1 } }, h('h1', {}, 'Notifications'), subtitle), markAll), chips, list);

async function open(n) {
  if (!n.isRead) { n.isRead = true; data.unreadCount = Math.max(0, data.unreadCount - 1); post(`/api/notifications/${n.id}/read`).catch(() => {}); }
  if (n.orderId) location.href = `/order.html?id=${n.orderId}`;
  else if (n.productId) location.href = `/product.html?id=${n.productId}`;
  else { draw(); refreshBadges(); }
}

function draw() {
  subtitle.textContent = data.unreadCount ? `${data.unreadCount} new alert${data.unreadCount === 1 ? '' : 's'}` : 'You are all caught up';
  markAll.hidden = data.unreadCount === 0;
  clear(chips);
  for (const [k, label] of FILTERS) chips.append(h('button', { class: `chip ${filter === k ? 'on' : ''}`, type: 'button', 'aria-pressed': String(filter === k), onclick: () => { filter = k; draw(); } }, label));
  const shown = data.notifications.filter((n) => filter === 'all' || n.kind === filter);
  clear(list);
  if (!shown.length) { list.append(empty({ title: filter === 'all' ? 'No alerts yet' : 'Nothing here', text: 'Price drops, restocks on shoes you saved and order updates show up here.', art: false })); return; }
  for (const n of shown) {
    list.append(h('button', { class: 'note', type: 'button', onclick: () => open(n) },
      h('span', { class: 'ico' }, icon(ICON[n.kind] || 'bell', 20)),
      h('span', {}, h('b', {}, n.title), h('p', {}, n.body), h('time', { datetime: n.createdAt }, timeAgo(n.createdAt))),
      n.isRead ? null : h('span', { class: 'unread', role: 'img', 'aria-label': 'Unread' })));
  }
}

try { data = await get('/api/notifications'); } catch (e) { list.append(empty({ title: 'Notifications did not load', text: errorText(e), art: false })); }
draw();

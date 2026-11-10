import { get } from '../api.js';
import { mountShell, h, icon, money, plural, itemImg, statusChip, empty, requireLogin, fmtDate, errorText } from '../ui.js';

const { user, main } = await mountShell({ page: 'orders' });
if (!requireLogin(user)) throw new Error('login needed');
document.title = 'My orders - Shushop';

main.append(h('div', { class: 'page-head' }, h('a', { class: 'iconbtn solid', href: '/profile.html', 'aria-label': 'Back to profile' }, icon('back')), h('h1', {}, 'My orders')));

let orders;
try { ({ orders } = await get('/api/orders')); } catch (e) { main.append(empty({ title: 'Orders did not load', text: errorText(e), art: false })); throw e; }

if (!orders.length) {
  main.append(empty({ title: 'No orders yet', text: 'When you order, you can follow every step of the delivery here.', action: { href: '/', label: 'Browse shoes' } }));
} else {
  main.append(h('div', { class: 'cards' }, orders.map((o) => {
    const shown = o.items.slice(0, 4);
    const names = o.items.map((i) => i.name);
    return h('a', { class: 'order-card', href: `/order.html?id=${o.id}` },
      h('div', { class: 'row between' }, h('h3', {}, `Order ${o.id}`), statusChip(o.status)),
      h('div', { class: 'thumbs' }, shown.map((i) => h('div', { class: 't' }, itemImg(i))), o.items.length > 4 ? h('div', { class: 't more-n' }, `+${o.items.length - 4}`) : null),
      h('div', { class: 'row between' },
        h('div', {}, h('div', {}, names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0]), h('div', { class: 'small muted' }, `${plural(o.itemCount, 'pair')}, placed ${fmtDate(o.createdAt)}`)),
        h('div', { class: 'price' }, money(o.total))));
  })));
}

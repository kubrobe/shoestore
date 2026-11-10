import { get, post, patch, put, del } from '../api.js';
import {mountShell, h, icon, clear, initials, plural, requireLogin, errorText, toast, openSheet, confirmSheet, money} from '../ui.js';

const { user: me, main } = await mountShell({ page: 'profile' });
if (!requireLogin(me)) throw new Error('login needed');
document.title = 'My profile - Shushop';

let user = me;
let [orders, favs, addrs, meta] = await Promise.all([get('/api/orders'), get('/api/favourites'), get('/api/addresses'), get('/api/meta')]);
const root = h('div');
main.append(root);

const onTheWay = () => orders.orders.filter((o) => ['new', 'processing', 'shipped'].includes(o.status)).length;

function row(iconName, title, sub, { href, onclick, pill } = {}) {
  const inner = [h('span', { class: 'ico' }, icon(iconName, 20)), h('span', {}, h('b', {}, title), h('small', {}, sub)), pill ? h('span', { class: 'pill' }, pill) : h('span'), icon('chevR', 18)];
  return href ? h('a', { href }, inner) : h('button', { class: 'row-link', type: 'button', onclick }, inner);
}

function editSheet() {
  const name = h('input', { class: 'input', value: user.fullName, required: true, minlength: 2, maxlength: 60 });
  const phone = h('input', { class: 'input', type: 'tel', value: user.phone || '', placeholder: '+998 90 123 45 67' });
  const size = h('select', { class: 'input' }, h('option', { value: '' }, 'Not set'), Array.from({ length: 35 }, (_, i) => 16 + i).map((s) => h('option', { value: s, selected: user.shoeSizeEu === s }, `EU ${s}`)));
  const msg = h('div', { class: 'error-text', role: 'alert' });
  const { close } = openSheet('Edit profile', h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    try { user = (await patch('/api/me', { fullName: name.value, phone: phone.value, shoeSizeEu: size.value === '' ? null : Number(size.value) })).user; close(); draw(); toast('Profile saved'); } catch (err) { msg.textContent = errorText(err); }
  } },
    h('label', { class: 'field' }, h('span', {}, 'Full name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Phone'), phone),
    h('label', { class: 'field' }, h('span', {}, 'Your shoe size'), size, h('span', { class: 'hint' }, 'We pick this size for you on every shoe page.')),
    msg, h('button', { class: 'btn', type: 'submit' }, 'Save changes')));
}

function passwordSheet() {
  const cur = h('input', { class: 'input', type: 'password', required: true, autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', required: true, minlength: 8, maxlength: 72, autocomplete: 'new-password' });
  const msg = h('div', { class: 'error-text', role: 'alert' });
  const { close } = openSheet('Change password', h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = '';
    try { await post('/api/me/password', { currentPassword: cur.value, newPassword: next.value }); close(); toast('Password changed. Other devices were logged out.'); } catch (err) { msg.textContent = errorText(err); }
  } },
    h('label', { class: 'field' }, h('span', {}, 'Current password'), cur),
    h('label', { class: 'field' }, h('span', {}, 'New password'), next, h('span', { class: 'hint' }, 'At least 8 characters.')),
    msg, h('button', { class: 'btn', type: 'submit' }, 'Change password')));
}

function addressesSheet() {
  const listBox = h('div', { class: 'pick-list' });
  const formBox = h('div');
  const sheet = openSheet('Shipping addresses', h('div', { class: 'stack' }, listBox, formBox), { onClose: draw });
  const refresh = async () => { addrs = await get('/api/addresses'); drawList(); };
  function drawList() {
    clear(listBox);
    if (!addrs.addresses.length) listBox.append(h('p', { class: 'muted' }, 'No addresses saved yet.'));
    for (const a of addrs.addresses) {
      listBox.append(h('div', { class: 'pick on', style: { gridTemplateColumns: '1fr auto' } },
        h('span', {}, h('b', {}, a.label, a.isDefault ? h('span', { class: 'pill', style: { marginLeft: '8px' } }, 'Main') : null), h('span', { class: 'sub' }, `${a.line}, ${a.city}`), h('br'), h('span', { class: 'sub' }, a.phone)),
        h('span', { class: 'row-actions' },
          a.isDefault ? null : h('button', { class: 'btn quiet sm', type: 'button', onclick: async () => { try { await put(`/api/addresses/${a.id}`, { ...a, isDefault: true }); await refresh(); } catch (e) { toast(errorText(e), 'error'); } } }, 'Make main'),
          h('button', { class: 'iconbtn sm', type: 'button', 'aria-label': `Delete ${a.label}`, onclick: async () => { try { await del(`/api/addresses/${a.id}`); await refresh(); } catch (e) { toast(errorText(e), 'error'); } } }, icon('trash', 18)))));
    }
    clear(formBox);
    if (addrs.addresses.length < 5) formBox.append(addForm());
  }
  function addForm() {
    const f = { label: h('input', { class: 'input', value: 'Home', maxlength: 30, required: true }), line: h('input', { class: 'input', placeholder: 'Street, house and flat', maxlength: 200, required: true }), city: h('input', { class: 'input', value: 'Tashkent', maxlength: 60, required: true }), phone: h('input', { class: 'input', type: 'tel', value: user.phone || '', required: true }) };
    const msg = h('div', { class: 'error-text', role: 'alert' });
    return h('form', { class: 'form', onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = '';
      try { await post('/api/addresses', { label: f.label.value, line: f.line.value, city: f.city.value, phone: f.phone.value }); await refresh(); toast('Address saved'); } catch (err) { msg.textContent = errorText(err); }
    } }, h('h3', {}, 'Add an address'),
      h('div', { class: 'two' }, h('label', { class: 'field' }, h('span', {}, 'Name'), f.label), h('label', { class: 'field' }, h('span', {}, 'City'), f.city)),
      h('label', { class: 'field' }, h('span', {}, 'Street, house and flat'), f.line), h('label', { class: 'field' }, h('span', {}, 'Phone'), f.phone), msg, h('button', { class: 'btn', type: 'submit' }, 'Save address'));
  }
  drawList();
  return sheet;
}

function helpSheet() {
  openSheet('Help and support', h('div', { class: 'stack' },
    h('div', {}, h('h3', {}, 'Delivery'), h('p', { class: 'muted' }, `Delivery costs ${money(meta.shippingFee)}. It is free when your order is ${money(meta.freeShippingFrom)} or more after any discount.`)),
    h('div', {}, h('h3', {}, 'Paying'), h('p', { class: 'muted' }, 'You pay when the courier arrives: cash, card, Payme or Click. Shushop never stores card details.')),
    h('div', {}, h('h3', {}, 'Changing your mind'), h('p', { class: 'muted' }, 'You can cancel an order until it is on its way. The pairs go back to the shop.')),
    h('div', {}, h('h3', {}, 'Wrong size?'), h('p', { class: 'muted' }, 'Save the shoe to your wishlist and we tell you when your size is back in stock.'))));
}

async function signOut() {
  const ok = await confirmSheet({ title: 'Sign out?', text: 'You can log back in any time. Your cart and wishlist stay saved.', confirm: 'Sign out' });
  if (!ok) return;
  try { await post('/api/logout'); } catch { /* the cookie is cleared by the next page anyway */ }
  location.href = '/';
}

function draw() {
  clear(root);
  const n = onTheWay();
  root.append(
    h('div', { class: 'me' }, h('div', { class: 'big' }, initials(user.fullName)),
      h('div', { class: 'grow' }, h('h1', {}, user.fullName), h('div', { class: 'muted small' }, user.email), h('div', { class: 'muted small' }, `Member since ${new Date(user.memberSince).getFullYear()}`)),
      h('button', { class: 'link small', type: 'button', onclick: editSheet }, 'Edit profile')),
    h('div', { class: 'stats' },
      h('div', {}, h('b', {}, String(orders.orders.length).padStart(2, '0')), h('span', {}, 'Orders')),
      h('div', {}, h('b', {}, String(favs.products.length).padStart(2, '0')), h('span', {}, 'Saved pairs')),
      h('div', {}, h('b', {}, user.shoeSizeEu ? `EU ${user.shoeSizeEu}` : '-'), h('span', {}, 'Shoe size'))),
    h('h2', { style: { marginBottom: '6px' } }, 'My account'),
    h('div', { class: 'menu' },
      row('box', 'My orders', 'Track, cancel or see past orders', { href: '/orders.html', pill: n ? `${n} on the way` : null }),
      row('pin', 'Shipping addresses', plural(addrs.addresses.length, 'saved address', 'saved addresses'), { onclick: addressesSheet }),
      row('key', 'Password', 'Change your password', { onclick: passwordSheet }),
      row('chat', 'Help and support', 'Delivery, paying and returns', { onclick: helpSheet }),
      user.role === 'admin' ? row('shield', 'Shop admin', 'Shoes, stock, orders and coupons', { href: '/admin.html' }) : null),
    h('button', { class: 'btn line', type: 'button', style: { marginTop: '28px' }, onclick: signOut }, icon('logout', 20), 'Sign out'));
}
draw();

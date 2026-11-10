import { post } from '../api.js';
import { mountShell, h, clear, errorText, params, safeNext } from '../ui.js';

const { user, main } = await mountShell({ page: 'login' });
const next = safeNext(params().get('next'));
if (user) location.replace(next);
document.title = 'Log in - Shushop';

let mode = params().get('mode') === 'register' ? 'register' : 'login';
const box = h('div', { class: 'auth' });
main.append(box);

function draw() {
  const msg = h('div', { class: 'error-text', role: 'alert' });
  const f = {
    name: h('input', { class: 'input', autocomplete: 'name', required: true, minlength: 2, maxlength: 60 }),
    email: h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, maxlength: 254 }),
    phone: h('input', { class: 'input', type: 'tel', autocomplete: 'tel', placeholder: '+998 90 123 45 67' }),
    password: h('input', { class: 'input', type: 'password', required: true, minlength: mode === 'register' ? 8 : 1, maxlength: 72, autocomplete: mode === 'register' ? 'new-password' : 'current-password' }),
  };
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const submit = h('button', { class: 'btn block', type: 'submit' }, mode === 'register' ? 'Create account' : 'Log in');
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = ''; submit.disabled = true;
    try {
      if (mode === 'register') await post('/api/register', { full_name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value });
      else await post('/api/login', { email: f.email.value, password: f.password.value });
      location.href = next;
    } catch (err) { msg.textContent = errorText(err); submit.disabled = false; }
  } },
    mode === 'register' ? field('Full name', f.name) : null,
    field('Email', f.email),
    mode === 'register' ? field('Phone (optional)', f.phone, 'The courier calls this number.') : null,
    field('Password', f.password, mode === 'register' ? 'At least 8 characters.' : null),
    msg, submit);
  const tab = (key, label) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(mode === key), onclick: () => { mode = key; draw(); } }, label);
  clear(box).append(
    h('div', { class: 'stack', style: { gap: '6px' } }, h('h1', {}, mode === 'register' ? 'Create your account' : 'Welcome back'), h('p', { class: 'muted' }, mode === 'register' ? 'Save shoes, track orders and get alerts when a pair is back.' : 'Log in to see your cart, orders and alerts.')),
    h('div', { class: 'tabs', role: 'tablist' }, tab('login', 'Log in'), tab('register', 'Sign up')),
    form,
    mode === 'login' ? h('p', { class: 'hint' }, 'Want to look around first? Use the demo account alex@demo.uz with the password demo12345.') : null);
  f.email.focus();
}
draw();

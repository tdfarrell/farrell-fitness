// App entry: auth gate, hash router, shell navigation and offline handling.
import { h, toast, closeAllSheets } from './ui.js';
import { get, post, flushOutbox, outboxCount, setUnauthorizedHandler, ApiError } from './api.js';
import { state, markStale, applyTheme } from './store.js';
import { loading, errorBox } from './components.js';
import { registerServiceWorker } from './pwa.js';
import * as today from './views/today.js';
import * as food from './views/food.js';
import * as weight from './views/weight.js';
import * as train from './views/train.js';
import * as progress from './views/progress.js';
import * as whoop from './views/whoop.js';
import * as settings from './views/settings.js';

const VIEWS = { today, food, weight, train, progress, whoop, settings };
const TITLES = { today: 'Today', food: 'Food log', weight: 'Weight', train: 'Training', progress: 'Progress', whoop: 'WHOOP', settings: 'Settings' };
const root = document.getElementById('view');
let cleanup = null;
let renderSeq = 0;

// Apply the saved theme before anything paints.
try { const t = localStorage.getItem('ff_theme'); if (t && t !== 'system') document.documentElement.setAttribute('data-theme', t); } catch {}

setUnauthorizedHandler(() => { state.user = null; if (!location.hash.startsWith('#/login')) location.hash = '#/login'; });

function parseHash() {
  const raw = (location.hash || '#/today').slice(2).split('?')[0];
  const [name, ...params] = raw.split('/').filter(Boolean);
  return { name: name || 'today', params };
}

async function route() {
  const seq = ++renderSeq;
  cleanup?.(); cleanup = null;
  closeAllSheets();
  const { name, params } = parseHash();

  if (name === 'login' || !state.user) {
    document.body.classList.add('logged-out');
    if (!state.user) {
      try { state.user = (await get('auth/status')).user; } catch { /* offline: fall through */ }
    }
    if (!state.user) { renderLogin(); return; }
    if (name === 'login') { location.hash = '#/today'; return; }
  }
  document.body.classList.remove('logged-out');

  const view = VIEWS[name] || today;
  document.querySelectorAll('[data-route]').forEach(a => {
    if (a.dataset.route === (VIEWS[name] ? name : 'today')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${TITLES[name] || 'Today'} | Farrell Fitness`;
  // Each visit renders into its own container, so a late re-render from a screen
  // you've already left lands in a detached element instead of over the new one.
  const container = h('div', { class: 'route' }, loading());
  root.replaceChildren(container);
  try {
    const result = await view.render(container, params);
    if (seq !== renderSeq) { if (typeof result === 'function') result(); return; }
    if (typeof result === 'function') cleanup = result;
    root.focus({ preventScroll: true });
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e instanceof ApiError && e.status === 401) return;
    console.error(e);
    container.replaceChildren(errorBox(navigator.onLine ? e : new Error("You're offline and this screen hasn't been loaded before."), route));
  }
}

function renderLogin() {
  const err = h('p', { class: 'banner', hidden: true, role: 'alert' });
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const r = await post('auth/login', { username: form.querySelector('#lg-u').value.trim(), password: form.querySelector('#lg-p').value, remember: true });
      state.user = r.user;
      markStale();
      location.hash = '#/today';
      route();
    } catch (ex) {
      err.textContent = ex instanceof ApiError ? ex.message : "Can't reach the server. Check your connection.";
      err.hidden = false;
    }
    btn.disabled = false;
  } },
    h('h1', null, 'Farrell Fitness'),
    h('p', { class: 'note' }, 'Sign in to your tracker.'),
    err,
    h('label', { class: 'field', for: 'lg-u' }, 'Username', h('input', { id: 'lg-u', autocomplete: 'username', autocapitalize: 'none', required: true })),
    h('label', { class: 'field', for: 'lg-p' }, 'Password', h('input', { id: 'lg-p', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in'));
  root.replaceChildren(h('div', { class: 'login' }, form));
  document.title = 'Sign in | Farrell Fitness';
  setTimeout(() => form.querySelector('#lg-u').focus(), 30);
}

/* ---------- offline ---------- */
let offlinePill = null;
function updateOnline() {
  if (!navigator.onLine) {
    if (!offlinePill) { offlinePill = h('div', { class: 'offline-pill', role: 'status' }, 'Offline. Changes will sync later.'); document.body.append(offlinePill); }
  } else {
    offlinePill?.remove(); offlinePill = null;
    if (outboxCount()) flushOutbox().then(n => { if (n) { toast(`Synced ${n} offline change${n > 1 ? 's' : ''}`); markStale(); route(); } });
  }
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

window.addEventListener('hashchange', route);
registerServiceWorker((activate) => {
  const t = h('div', { class: 'toast', role: 'status' }, 'A new version is ready. ',
    h('button', { class: 'btn sm', style: { marginLeft: '8px', height: '32px' }, onclick: () => { activate(); t.remove(); } }, 'Update'));
  document.body.append(t);
});
// Refresh numbers when returning to the app after a while (new day, WHOOP sync, etc.).
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 10 * 60000 && state.user && !location.hash.includes('train/active')) { markStale(); route(); }
});

applyTheme();
updateOnline();
route();

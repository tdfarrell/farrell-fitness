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
import * as plans from './views/plans.js';
import * as health from './views/health.js';
import * as habits from './views/habits.js';
import * as journal from './views/journal.js';
import * as more from './views/more.js';
import * as body from './views/body.js';
import * as insights from './views/insights.js';
import * as report from './views/report.js';
import * as projection from './views/projection.js';
import { openQuickAddMenu } from './quickadd.js';

const VIEWS = { today, food, plans, weight, train, progress, whoop, settings, health, habits, journal, more, body, insights, report, projection };
const TITLES = { today: 'Today', food: 'Food', plans: 'Meal plans', weight: 'Weight', train: 'Training', progress: 'Progress', whoop: 'WHOOP',
  settings: 'Settings', health: 'Health', habits: 'Habits', journal: 'Journal', more: 'More', body: 'Body', insights: 'Insights', report: 'Weekly report', projection: 'Goal projection' };
// Which bottom tab lights up for each screen.
const TAB = { today: 'today', food: 'food', plans: 'food', train: 'train' };
const root = document.getElementById('view');
const scroller = document.querySelector('.content');
let lastScreen = null;
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
  const current = VIEWS[name] ? name : 'today';
  // The content area is the scroller now, so a new screen starts at the top. Re-renders of the
  // same screen (after a quick add, a sync) keep their place.
  const screen = location.hash.split('?')[0];
  if (screen !== lastScreen) { scroller.scrollTop = 0; lastScreen = screen; }
  document.querySelectorAll('[data-route]').forEach(a => {
    if (a.dataset.route === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-tab]').forEach(a => {
    if (a.dataset.tab === (TAB[current] || 'more')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
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
    h('img', { class: 'logo', src: 'icons/logo-mark.svg', alt: '', width: 92, height: 75 }),
    h('h1', null, 'Farrell Fitness'),
    h('p', { class: 'note' }, 'Sign in to your tracker.'),
    err,
    h('label', { class: 'field', for: 'lg-u' }, 'Username', h('input', { id: 'lg-u', autocomplete: 'username', autocapitalize: 'none', required: true })),
    h('label', { class: 'field', for: 'lg-p' }, 'Password', h('input', { id: 'lg-p', type: 'password', autocomplete: 'current-password', required: true })),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in'),
    h('a', { href: 'privacy.html', class: 'small', style: { alignSelf: 'center' } }, 'Privacy policy'));
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
// The + button (bottom bar on phones, sidebar on desktop).
document.addEventListener('click', (e) => {
  if (e.target.closest?.('[data-quick-add]') && state.user) openQuickAddMenu();
});
// Anything that changes data from outside the current screen (quick add) asks for a re-render.
window.addEventListener('ff:changed', () => { markStale(); route(); });
// A tapped reminder can ask an open window to go to a screen.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open' && typeof e.data.url === 'string') { const i = e.data.url.indexOf('#'); if (i >= 0) location.hash = e.data.url.slice(i); }
});
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

// In-app back navigation. An installed iPhone app has no browser back button, so every screen
// below the four tab front pages gets one. It goes to the screen you came from, or to a sensible
// parent when there's no history (opened from a reminder, after a refresh, a deep link).
import { h, icon } from './ui.js';

const KEY = 'ff_nav';
const MAX = 30;
// Tab front pages: no back button, and reaching one starts a fresh history.
const ROOTS = new Set(['today', 'food', 'train', 'more']);
// Screens that never show a back button (the live workout keeps Finish and Discard).
const NO_BACK = new Set(['train/active', 'train/new', 'stretch/run']);

let cur = { name: 'today', params: [], hash: '#/today' };

function load() {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || '[]'); return Array.isArray(s) ? s : []; } catch { return []; }
}
function save(s) { try { sessionStorage.setItem(KEY, JSON.stringify(s.slice(-MAX))); } catch {} }

/** The hash without its query string. */
const bare = (hash) => (hash || '#/today').split('?')[0];
/** Two hashes that differ only by a date (or diary vs a date) are the same screen: day and week
 *  arrows replace the entry instead of stacking up, so back leaves the screen. */
export function screenKey(hash) {
  return bare(hash).replace(/\d{4}-\d{2}-\d{2}/g, ':d').replace(/^#\/food\/diary$/, '#/food/:d')
    .replace(/^#\/(habits|journal|report)$/, '#/$1/:d');
}

export function isRoot(name, params) { return ROOTS.has(name) && params.length === 0; }

/** Called by the router before each render. */
export function recordRoute(name, params, hash) {
  cur = { name, params, hash };
  let stack = load();
  if (isRoot(name, params)) { save([hash]); return; }
  const i = stack.lastIndexOf(hash);
  if (i >= 0) stack = stack.slice(0, i + 1); // went back (in-app or the browser's back)
  else if (stack.length && screenKey(stack[stack.length - 1]) === screenKey(hash)) stack[stack.length - 1] = hash;
  else stack.push(hash);
  save(stack);
}

/** Where back goes when there's no history to return to. */
export function parentOf(name, p = []) {
  switch (name) {
    case 'food': return p[0] === 'nutrients' ? `#/food/${p[1] || 'diary'}` : '#/food';
    case 'plans': return p.length ? '#/plans' : '#/food';
    case 'train':
      if (p[0] === 'cardio' && p[1]) return '#/train/cardio';
      if (p[0] === 'stretch' && p[1]) return '#/train/stretch';
      if (p[0] === 'schedule' && p[1]) return '#/train/schedule';
      return '#/train';
    case 'health': return p.length ? '#/health' : '#/more';
    case 'body': return p.length ? '#/body' : '#/more';
    case 'settings': return p.length ? '#/settings' : '#/more';
    case 'users': return '#/settings';
    case 'report': return p.length ? '#/report' : '#/more';
    default: return '#/more';
  }
}

const NAMES = {
  today: 'Today', food: 'Food', plans: 'Meal plans', weight: 'Weight', train: 'Train', progress: 'Progress', whoop: 'WHOOP',
  settings: 'Settings', health: 'Health', habits: 'Habits', journal: 'Journal', more: 'More', body: 'Body', insights: 'Insights',
  report: 'Weekly report', projection: 'Goal projection', phases: 'Diet phases', users: 'Users',
};
/** A short name for a screen, for "Back to …". */
export function labelFor(hash) {
  const [name, ...p] = bare(hash).slice(2).split('/').filter(Boolean);
  if (name === 'food' && p[0] === 'nutrients') return 'Nutrients';
  if (name === 'food' && p.length) return 'Food log';
  if (name === 'train' && p.length) {
    const sub = { strength: 'Strength', cardio: 'Cardio', progress: 'Progress', stretch: 'Stretching', schedule: 'Schedule', exercise: 'Exercise' }[p[0]];
    if (sub && (p.length === 1 || p[0] === 'exercise')) return sub;
    if (p[0] === 'cardio') return 'Cardio session';
    if (p[0] === 'stretch') return 'Stretch routine';
    return 'Workout';
  }
  if (name === 'health' && p[0] === 'meds') return 'Meds and supplements';
  if (name === 'health' && p[0] === 'labs') return 'Labs and blood sugar';
  if (name === 'body' && p[0] === 'photos') return 'Photos';
  if (name === 'body' && p[0] === 'compare') return 'Compare';
  if (name === 'settings' && p[0] === 'sync') return 'Reminders and sync';
  if (name === 'settings' && p[0] === 'rest') return 'Rest timer';
  if (name === 'report' && p.length) return 'Weekly report';
  if (name === 'plans' && p.length) return 'Meal plan';
  return NAMES[name] || 'Back';
}

/** Where the back button goes from the current screen, or null for none. */
export function backTarget() {
  const { name, params, hash } = cur;
  if (isRoot(name, params) || NO_BACK.has(`${name}/${params[0] || ''}`) || name === 'login') return null;
  const stack = load();
  const i = stack.lastIndexOf(hash);
  if (i > 0) return stack[i - 1];
  return parentOf(name, params);
}

/** Top-level screens are in the desktop sidebar, so the button only shows on phones there. */
export function isTopLevel() { return cur.params.length === 0; }

export function goBack() {
  const target = backTarget();
  if (!target) return;
  const stack = load();
  const i = stack.lastIndexOf(cur.hash);
  if (i > 0) save(stack.slice(0, i)); else save([target]);
  // Replace, so the browser history doesn't keep growing (matters for Android's back button).
  location.replace(target);
}

/** The arrow button at the left of a page header, or null when this screen has none. */
export function backButton() {
  const target = backTarget();
  if (!target) return null;
  return h('a', {
    class: 'back-btn' + (isTopLevel() ? ' top' : ''), href: target, 'aria-label': `Back to ${labelFor(target)}`,
    onclick: (e) => { e.preventDefault(); goBack(); },
  }, icon('back', 24));
}

/* Swipe from the left edge to go back, like a native iPhone app. */
let sx = null, sy = 0, st = 0;
export function initEdgeSwipe(el) {
  el.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    sx = (e.touches.length === 1 && t.clientX < 24 && !document.querySelector('.scrim')) ? t.clientX : null;
    sy = t.clientY; st = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
    sx = null;
    if (dx > 70 && dy < 50 && Date.now() - st < 600 && backTarget()) goBack();
  }, { passive: true });
}

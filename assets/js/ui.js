// Small DOM toolkit: element builder, icons, formatting, sheets and toasts.

export function h(tag, attrs, ...children) {
  const svgTags = ['svg', 'path', 'circle', 'line', 'polyline', 'rect', 'text', 'g', 'polygon'];
  const isSvg = svgTags.includes(tag);
  const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v; // only used with trusted, static strings
      else if (k === 'value' && !isSvg) el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled') { el[k] = !!v; if (v) el.setAttribute(k, ''); }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  today: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2 1-3 4-3 8h3"/>',
  weight: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 9a5 5 0 0 1 8 0l-3 3"/>',
  train: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  progress: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  whoop: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  barcode: '<path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M17 9v6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 13a8 8 0 0 0 14.5 4.5L20 16M4 4v4h4M20 20v-4h-4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
};
export function icon(name, size) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'check' ? '3' : '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
  s.innerHTML = ICONS[name] || '';
  return s;
}

/* ---------- formatting ---------- */
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmt0 = (v) => (v == null || Number.isNaN(v) ? '-' : nf0.format(Math.round(v)));
export const fmt1 = (v) => (v == null || Number.isNaN(v) ? '-' : nf1.format(v));
export const signed = (v, f = fmt1) => (v == null ? '-' : (v > 0 ? '+' : v < 0 ? '-' : '') + f(Math.abs(v)));

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function longDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
export function shortDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
export function relDay(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  const y = new Date(t + 'T12:00:00'); y.setDate(y.getDate() - 1);
  if (iso === y.toISOString().slice(0, 10)) return 'Yesterday';
  return shortDate(iso);
}
export function timeAgo(unix) {
  if (!unix) return 'never';
  const s = Date.now() / 1000 - unix;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function hoursMin(hrs) {
  if (hrs == null) return '-';
  const m = Math.round(hrs * 60);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/* ---------- sheets, toasts ---------- */
let sheetStack = [];
export function openSheet({ title, body, tall = false, onClose, label }) {
  const close = () => {
    scrim.remove();
    sheetStack = sheetStack.filter(s => s !== scrim);
    document.removeEventListener('keydown', onKey);
    if (!sheetStack.length) document.body.style.overflow = '';
    opener?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === scrim) close(); };
  const opener = document.activeElement;
  const titleEl = h('h2', { id: 'sheet-' + Math.random().toString(36).slice(2) }, title);
  const bodyEl = h('div', { class: 'sheet-body' });
  const sheet = h('section', { class: 'sheet' + (tall ? ' tall' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleEl.id, 'aria-label': label },
    h('div', { class: 'grab', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, titleEl, h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
    bodyEl);
  const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, sheet);
  document.body.append(scrim);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  sheetStack.push(scrim);
  const api = { close, body: bodyEl, setTitle: (t) => { titleEl.textContent = t; }, el: sheet };
  if (typeof body === 'function') body(api); else if (body) bodyEl.append(body);
  setTimeout(() => (sheet.querySelector('[autofocus]') || sheet.querySelector('input, select, button:not(.icon-btn)'))?.focus?.(), 30);
  return api;
}

/** Close every open sheet (used when the screen changes). */
export function closeAllSheets() {
  sheetStack.forEach(s => s.remove());
  sheetStack = [];
  document.body.style.overflow = '';
}

export function toast(msg, kind = '') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast ' + kind, role: 'status', 'aria-live': 'polite' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 5000 : 2600);
}

export function confirmSheet(title, message, actionLabel = 'Delete') {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      onClose: () => { if (!answered) resolve(false); },
      body: h('div', { class: 'stack' },
        h('p', { class: 'note' }, message),
        h('div', { class: 'grid-2' },
          h('button', { class: 'btn', onclick: () => { answered = true; s.close(); resolve(false); } }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => { answered = true; s.close(); resolve(true); } }, actionLabel))),
    });
  });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function recoveryColor(r) {
  if (r == null) return 'var(--muted)';
  return r >= 67 ? 'var(--green)' : r >= 34 ? 'var(--yellow)' : 'var(--red)';
}

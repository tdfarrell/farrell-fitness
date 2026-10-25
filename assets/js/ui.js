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
  plans: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  health: '<path d="M12 20s-8-4.9-8-10.2A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8 2.8C20 15.1 12 20 12 20z"/><path d="M7 12h3l1.5-2.5 2 4 1.5-1.5h2"/>',
  habits: '<path d="M4 7l2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7"/>',
  journal: '<path d="M6 3h11l3 3v15H6zM10 9h6M10 13h6M10 17h4"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  pill: '<rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M9.4 7.6l4.1 5.8"/>',
  drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  run: '<circle cx="14" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v4M6 12l3-3.5 4.5 1 2.5 3h3M11 15l1.5-5"/>',
  walk: '<circle cx="12.5" cy="4.5" r="1.8"/><path d="M10 21l1.5-6 2.5 2.5V21M8 13l2.5-4.5h3l2.5 4M11.5 15l1-6.5"/>',
  bike: '<circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-7h5l3 7M10 10l2.5 7M9 6h3"/>',
  rope: '<circle cx="12" cy="4.5" r="1.8"/><path d="M12 7v7M9 21l3-7 3 7M8 10h8M5 6v6a7 7 0 0 0 14 0V6"/>',
  row: '<path d="M3 18h18M6 18l4-7h4M14 11l4-5M9 7h3"/><circle cx="9" cy="5" r="1.6"/>',
  swim: '<circle cx="16" cy="6" r="1.8"/><path d="M3 18c2 0 2-1.5 4.5-1.5S10 18 12 18s2.5-1.5 4.5-1.5S19 18 21 18M6 13l4-3 3 2 3-2"/>',
  hike: '<circle cx="12" cy="4.5" r="1.8"/><path d="M9 21l2-7 3 2v5M8 12l2-4h3l2 4M17 10v11"/>',
  stairs: '<path d="M4 20h4v-4h4v-4h4V8h4"/>',
  flame: '<path d="M12 21c4 0 6-2.8 6-6.2 0-4.3-4-6.3-4.5-10.8C10 6 8 9 8 11.5 7 11 6.5 10 6.5 9 5.5 10.5 6 13 6 14.8 6 18.2 8 21 12 21z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  torch: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
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

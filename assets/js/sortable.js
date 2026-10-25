// Drag to reorder. Each row has a grip handle; press and drag it (finger or mouse) and the other rows
// make room as you go. The handle also works from the keyboard: arrow keys move the row.
// Rows are moved in the DOM as you drag, so `onChange` just reads the new order.
import { h, icon } from './ui.js';

const GRIP = '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>';

/** A grip button for a row. `label` names the item for screen readers. */
export function gripHandle(label) {
  const svg = icon('more');
  svg.innerHTML = GRIP;
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('stroke', 'none');
  return h('button', { type: 'button', class: 'grip', 'aria-label': `Reorder ${label}. Drag, or use the up and down arrow keys`, 'data-grip': '' }, svg);
}

let live = null;
function announce(msg) {
  if (!live) { live = h('div', { class: 'sr', 'aria-live': 'assertive', role: 'status' }); document.body.append(live); }
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
}

/**
 * Make the children of `list` reorderable. Each child needs a `data-key` and a [data-grip] button inside.
 * onChange(keys) runs after a drop or keyboard move with the keys in their new order.
 */
export function makeSortable(list, { onChange, label = (row) => row.dataset.label || 'item' } = {}) {
  const rows = () => [...list.children].filter(c => c.dataset.key != null);
  const keys = () => rows().map(r => r.dataset.key);
  const scroller = () => {
    let el = list.parentElement;
    while (el && el !== document.body) { const o = getComputedStyle(el).overflowY; if (o === 'auto' || o === 'scroll') return el; el = el.parentElement; }
    return document.querySelector('.content');
  };

  list.classList.add('sortable');

  list.addEventListener('keydown', (e) => {
    const grip = e.target.closest?.('[data-grip]');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const row = grip.closest('[data-key]');
    const all = rows();
    const i = all.indexOf(row);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return;
    if (e.key === 'ArrowUp') list.insertBefore(row, all[j]); else list.insertBefore(row, all[j].nextSibling);
    grip.focus();
    announce(`${label(row)} moved to position ${j + 1} of ${all.length}`);
    onChange?.(keys());
  });

  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest?.('[data-grip]');
    if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = grip.closest('[data-key]');
    if (!row) return;
    e.preventDefault();
    const sc = scroller();
    const before = keys().join('|');
    let startY = e.clientY;
    let lastY = e.clientY;
    let scrollStart = sc?.scrollTop || 0;
    let raf = 0;
    row.classList.add('dragging');
    list.classList.add('is-sorting');
    grip.setPointerCapture?.(e.pointerId);
    navigator.vibrate?.(8);

    const place = () => {
      const dy = lastY - startY + ((sc?.scrollTop || 0) - scrollStart);
      row.style.transform = `translateY(${dy}px)`;
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      const others = rows().filter(x => x !== row);
      // Find the first row whose middle is below ours; we belong just before it.
      let target = null;
      for (const o of others) { const orc = o.getBoundingClientRect(); if (mid < orc.top + orc.height / 2) { target = o; break; } }
      const cur = row.nextElementSibling;
      if (target !== cur && !(target === null && rows()[rows().length - 1] === row)) {
        const oldTop = row.offsetTop;
        list.insertBefore(row, target);
        // Keep the row under the finger: account for how far its resting spot moved.
        startY += row.offsetTop - oldTop;
        row.style.transform = `translateY(${lastY - startY + ((sc?.scrollTop || 0) - scrollStart)}px)`;
      }
    };
    const autoScroll = () => {
      raf = 0;
      if (!sc) return;
      const b = sc.getBoundingClientRect();
      const edge = 56;
      const v = lastY < b.top + edge ? -Math.ceil((b.top + edge - lastY) / 4) : lastY > b.bottom - edge ? Math.ceil((lastY - (b.bottom - edge)) / 4) : 0;
      if (v) { sc.scrollTop += v; place(); raf = requestAnimationFrame(autoScroll); }
    };
    const move = (ev) => { lastY = ev.clientY; place(); if (!raf) raf = requestAnimationFrame(autoScroll); };
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      cancelAnimationFrame(raf);
      row.classList.remove('dragging');
      list.classList.remove('is-sorting');
      row.style.transform = '';
      const after = keys();
      if (after.join('|') !== before) { announce(`${label(row)} moved to position ${after.indexOf(row.dataset.key) + 1} of ${after.length}`); onChange?.(after); }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  });
}

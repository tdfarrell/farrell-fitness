// Lightweight SVG charts. Each series is an array aligned to the same x positions (nulls allowed).
import { h } from './ui.js';

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.001; v += step) ticks.push(+v.toFixed(6));
  return { ticks, lo: Math.min(start, lo), hi: Math.max(ticks[ticks.length - 1], hi) };
}

export function chart({ w: wIn = 640, h: hIn = 220, n, lines = [], dots = [], bars = [], hline, label, xLabels = [], yFormat = (v) => String(v), yMin, yMax, compact = false }) {
  // Draw at roughly the on-screen width so labels stay readable on phones.
  const screenW = (typeof window !== 'undefined' && window.innerWidth) || wIn;
  const w = compact ? wIn : Math.round(Math.min(wIn, Math.max(300, screenW - 64)));
  const H = compact ? hIn : Math.round(hIn * Math.max(0.8, Math.sqrt(w / wIn)));
  const all = [...lines, ...dots, ...bars].flatMap(s => s.values).filter(v => v != null && !Number.isNaN(v));
  if (hline?.value != null) all.push(hline.value);
  if (!all.length) return h('p', { class: 'empty small' }, 'Not enough data yet.');
  let lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  const nt = niceTicks(lo - (yMin == null ? pad : 0), hi + (yMax == null ? pad : 0), compact ? 3 : 4);
  lo = nt.lo; hi = nt.hi;
  const left = compact ? 0 : 44, right = 6, top = 8, bottom = xLabels.length ? 22 : 6;
  const pw = w - left - right, ph = H - top - bottom;
  const X = (i) => left + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v) => top + ((hi - v) / (hi - lo)) * ph;
  const svg = h('svg', { class: 'chart', viewBox: `0 0 ${w} ${H}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });

  if (!compact) {
    for (const t of nt.ticks) {
      svg.append(h('line', { x1: left, x2: w - right, y1: Y(t), y2: Y(t), stroke: 'var(--rule)', 'stroke-width': 1 }));
      svg.append(h('text', { x: 0, y: Y(t) + 4 }, yFormat(t)));
    }
  }
  for (const xl of xLabels) {
    svg.append(h('text', { x: X(xl.i), y: H - 4, 'text-anchor': xl.i === 0 ? 'start' : xl.i === n - 1 ? 'end' : 'middle' }, xl.text));
  }
  for (const b of bars) {
    const bw = Math.max(3, Math.min(28, (pw / n) * 0.62));
    b.values.forEach((v, i) => {
      if (v == null) {
        if (b.emptyColor) svg.append(h('rect', { x: X(i) - bw / 2, y: Y(lo + (hi - lo) * 0.35), width: bw, height: Y(lo) - Y(lo + (hi - lo) * 0.35), rx: 4, fill: b.emptyColor }));
        return;
      }
      const y = Y(Math.max(v, lo));
      svg.append(h('rect', { x: X(i) - bw / 2, y, width: bw, height: Math.max(1, Y(lo) - y), rx: Math.min(4, bw / 3), fill: b.colorFn ? b.colorFn(v, i) : b.color }));
    });
  }
  if (hline?.value != null) {
    svg.append(h('line', { x1: left, x2: w - right, y1: Y(hline.value), y2: Y(hline.value), stroke: hline.color || 'var(--ink)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
  }
  for (const d of dots) {
    d.values.forEach((v, i) => { if (v != null) svg.append(h('circle', { cx: X(i), cy: Y(v), r: d.r || 3, fill: d.color || 'var(--dot)' })); });
  }
  for (const l of lines) {
    // Break the line at nulls.
    let seg = [];
    const flush = () => {
      if (seg.length > 1) svg.append(h('polyline', { points: seg.join(' '), fill: 'none', stroke: l.color, 'stroke-width': l.width || 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': l.dash || null }));
      seg = [];
    };
    l.values.forEach((v, i) => { if (v == null) flush(); else seg.push(`${X(i).toFixed(1)},${Y(v).toFixed(1)}`); });
    flush();
    if (l.endDot) {
      const i = l.values.map((v, k) => (v == null ? -1 : k)).filter(k => k >= 0).pop();
      if (i != null) svg.append(h('circle', { cx: X(i), cy: Y(l.values[i]), r: 5, fill: l.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    }
  }
  return svg;
}

export function sparkline(values, color, label) {
  const v = values.filter(x => x != null);
  if (v.length < 2) return h('div', { style: { height: '44px' } });
  return chart({ w: 140, h: 44, n: values.length, lines: [{ values, color, width: 2.5 }], label, compact: true });
}

/** x-axis labels at a few evenly spaced dates. */
export function dateTicks(dates, count = 4) {
  if (dates.length < 2) return [];
  const out = [];
  for (let k = 0; k < count; k++) {
    const i = Math.round((k * (dates.length - 1)) / (count - 1));
    out.push({ i, text: new Date(dates[i] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) });
  }
  return out;
}

/** Scatter plot of [x, y] points with an optional straight-line fit. */
export function scatter({ points, w: wIn = 560, h: hIn = 200, xFormat = String, yFormat = String, fit, label, color = 'var(--soft-primary)', fitColor = 'var(--kcal)', xTicks = 4 }) {
  const pts = points.filter(([x, y]) => x != null && y != null);
  if (pts.length < 3) return h('p', { class: 'empty small' }, 'Not enough data yet.');
  const screenW = (typeof window !== 'undefined' && window.innerWidth) || wIn;
  const w = Math.round(Math.min(wIn, Math.max(280, screenW - 64)));
  const H = hIn;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const nx = niceTicks(Math.min(...xs), Math.max(...xs), xTicks);
  const ny = niceTicks(Math.min(...ys), Math.max(...ys), 3);
  const left = 44, right = 8, top = 8, bottom = 22;
  const X = (v) => left + ((v - nx.lo) / (nx.hi - nx.lo || 1)) * (w - left - right);
  const Y = (v) => top + ((ny.hi - v) / (ny.hi - ny.lo || 1)) * (H - top - bottom);
  const svg = h('svg', { class: 'chart', viewBox: `0 0 ${w} ${H}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });
  for (const t of ny.ticks) {
    svg.append(h('line', { x1: left, x2: w - right, y1: Y(t), y2: Y(t), stroke: 'var(--rule)', 'stroke-width': 1 }));
    svg.append(h('text', { x: 0, y: Y(t) + 4 }, yFormat(t)));
  }
  nx.ticks.forEach((t, i) => svg.append(h('text', { x: X(t), y: H - 4, 'text-anchor': i === 0 ? 'start' : i === nx.ticks.length - 1 ? 'end' : 'middle' }, xFormat(t))));
  for (const [x, y] of pts) svg.append(h('circle', { cx: X(x), cy: Y(y), r: 3.5, fill: color, 'fill-opacity': 0.85 }));
  if (fit && fit.slope != null) {
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    svg.append(h('line', { x1: X(x0), y1: Y(fit.intercept + fit.slope * x0), x2: X(x1), y2: Y(fit.intercept + fit.slope * x1), stroke: fitColor, 'stroke-width': 3, 'stroke-linecap': 'round' }));
  }
  return svg;
}

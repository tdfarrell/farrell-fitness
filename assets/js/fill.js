// "Fill my macros": find one or two of your own foods, in sensible portions, that best cover what's left today.
// Foods are per 100 g: { id, name, kcal, protein, carbs, fat, portions: [{label, grams}], use_count }.

const MACROS = ['protein', 'carbs', 'fat'];
const MAX_GRAMS = 600;

/** Relative misses for protein, carbs, fat and calories, each capped at 1. Lower is better. */
function misses(t, r) {
  return [
    ...MACROS.map(m => Math.min(1, Math.abs(t[m] - r[m]) / Math.max(r[m], 10))),
    Math.min(1, Math.abs(t.kcal - r.kcal) / Math.max(r.kcal, 100)),
  ];
}

/** 0 to 100: how closely totals match what's left. */
export function fitScore(t, r) {
  const e = misses(t, r);
  return Math.max(0, Math.round(100 * (1 - e.reduce((a, b) => a + b, 0) / e.length)));
}

// Weighted squared error; going over costs a bit more than falling short.
function cost(t, r) {
  let c = 0;
  for (const m of MACROS) {
    const d = (t[m] - r[m]) / Math.max(r[m], 10);
    c += d * d * (d > 0.05 ? 1.6 : 1);
  }
  const dk = (t.kcal - r.kcal) / Math.max(r.kcal, 100);
  return c + dk * dk * 2 * (dk > 0.05 ? 1.6 : 1);
}

const per = (f, g) => ({ kcal: f.kcal * g / 100, protein: f.protein * g / 100, carbs: f.carbs * g / 100, fat: f.fat * g / 100 });
const add = (a, b) => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat });
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

/** Rounds grams to a portion people would actually eat: half servings, or 5 or 10 g steps. */
export function roundPortion(f, grams) {
  const p = (f.portions || []).find(x => x.grams > 0 && !/whole recipe/i.test(x.label));
  if (p) {
    const qty = Math.max(0.5, Math.round((grams / p.grams) * 2) / 2);
    const g = qty * p.grams;
    return { grams: g, quantity: qty, portion_label: `${qty} x ${p.label}`, show: `${portionText(p.label, qty)} (${Math.round(g)} g)` };
  }
  const step = grams < 60 ? 5 : 10;
  const g = Math.max(step, Math.round(grams / step) * step);
  return { grams: g, quantity: g, portion_label: `${g} g`, show: `${g} g` };
}

const FRAC = (q) => { const w = Math.floor(q); const half = q - w >= 0.5; return w === 0 ? '½' : `${w}${half ? '½' : ''}`; };
/** "1 cup (158 g)" at 1.5 becomes "1½ cups"; "serving (30 g)" at 2 becomes "2 servings". */
export function portionText(label, qty) {
  let unit = label.replace(/\s*\([^)]*\)\s*$/, '').replace(/^1\s+/, '').trim() || 'serving';
  if (qty > 1 && /^[a-z]+$/i.test(unit) && !/s$/i.test(unit)) unit += /(ch|sh|x)$/i.test(unit) ? 'es' : 's';
  return `${FRAC(qty)} ${unit}`;
}

/** Best grams of one food for target r (closed form for the quadratic cost, then clamped). */
function bestOne(f, r) {
  const a = MACROS.map(m => f[m] / 100);
  const s = MACROS.map(m => Math.max(r[m], 10));
  let num = 0, den = 0;
  MACROS.forEach((m, i) => { num += a[i] * r[m] / (s[i] * s[i]); den += a[i] * a[i] / (s[i] * s[i]); });
  const ak = f.kcal / 100, sk = Math.max(r.kcal, 100);
  num += 2 * ak * r.kcal / (sk * sk); den += 2 * ak * ak / (sk * sk);
  return den > 0 ? Math.max(0, Math.min(MAX_GRAMS, num / den)) : 0;
}

/** Best grams of two foods together: 2x2 weighted least squares. Null if one would go negative. */
function bestTwo(f1, f2, r) {
  const rows = [...MACROS.map(m => [f1[m] / 100, f2[m] / 100, r[m], 1 / Math.max(r[m], 10) ** 2]),
    [f1.kcal / 100, f2.kcal / 100, r.kcal, 2 / Math.max(r.kcal, 100) ** 2]];
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (const [x, y, t, w] of rows) { a11 += w * x * x; a12 += w * x * y; a22 += w * y * y; b1 += w * x * t; b2 += w * y * t; }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-12) return null;
  const g1 = (b1 * a22 - b2 * a12) / det, g2 = (a11 * b2 - a12 * b1) / det;
  if (g1 < 15 || g2 < 15 || g1 > MAX_GRAMS || g2 > MAX_GRAMS) return null;
  return [g1, g2];
}

/**
 * Suggestions for what's left. mode 'pair' allows up to two foods; 'one' only single foods.
 * Returns up to `count` options, best first, with no food in more than two of them.
 */
export function suggest(foods, remaining, { mode = 'pair', count = 4, pool = 80 } = {}) {
  const r = { kcal: Math.max(0, remaining.kcal), protein: Math.max(0, remaining.protein), carbs: Math.max(0, remaining.carbs), fat: Math.max(0, remaining.fat) };
  const list = foods.filter(f => f.kcal > 0).slice(0, pool);
  const options = [];
  const build = (items) => {
    const rounded = items.map(([f, g]) => ({ food: f, ...roundPortion(f, g) }));
    const totals = rounded.reduce((a, it) => add(a, per(it.food, it.grams)), ZERO);
    return { items: rounded, totals, fit: fitScore(totals, r), cost: cost(totals, r) };
  };
  for (const f of list) {
    const g = bestOne(f, r);
    if (g >= 15) options.push(build([[f, g]]));
  }
  if (mode === 'pair') {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const gs = bestTwo(list[i], list[j], r);
        if (gs) options.push(build([[list[i], gs[0]], [list[j], gs[1]]]));
      }
    }
  }
  options.sort((a, b) => a.cost - b.cost || b.fit - a.fit);
  const used = new Map();
  const seen = new Set();
  const out = [];
  for (const o of options) {
    const key = o.items.map(it => `${it.food.id}:${it.grams}`).sort().join('|');
    if (seen.has(key)) continue;
    if (o.items.some(it => (used.get(it.food.id) || 0) >= 2)) continue;
    seen.add(key);
    o.items.forEach(it => used.set(it.food.id, (used.get(it.food.id) || 0) + 1));
    out.push(o);
    if (out.length >= count) break;
  }
  return out;
}

// Small statistics and date helpers shared by Insights, the weekly report and the overviews.
import { addDays, fiberTarget } from './tdee.js';

export const mean = (a) => { const v = a.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
export const sum = (a) => a.reduce((p, q) => p + (q || 0), 0);
export function sd(a) {
  const v = a.filter(x => x != null); const m = mean(v);
  if (v.length < 2) return null;
  return Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / (v.length - 1));
}
export function median(a) {
  const v = a.filter(x => x != null).sort((p, q) => p - q);
  if (!v.length) return null;
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
}

/** Two-sided p-value from a z or large-sample t statistic (normal approximation). */
export function pFromZ(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 2 * p;
}

/** Pearson correlation over pairs [[x, y], ...] with nulls dropped. */
export function correlation(pairs) {
  const p = pairs.filter(([x, y]) => x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y));
  const n = p.length;
  if (n < 3) return { r: null, n, p: 1, slope: null, intercept: null };
  const mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  if (!sxx || !syy) return { r: 0, n, p: 1, slope: 0, intercept: my };
  const r = sxy / Math.sqrt(sxx * syy);
  const t = r * Math.sqrt((n - 2) / Math.max(1e-9, 1 - r * r));
  return { r, n, p: pFromZ(t), slope: sxy / sxx, intercept: my - (sxy / sxx) * mx };
}

/** Compare two groups: difference of means, Cohen's d and a Welch-style p-value. */
export function compareGroups(a, b) {
  const x = a.filter(v => v != null), y = b.filter(v => v != null);
  if (x.length < 2 || y.length < 2) return { diff: null, d: null, p: 1, na: x.length, nb: y.length };
  const ma = mean(x), mb = mean(y), sa = sd(x), sb = sd(y);
  const pooled = Math.sqrt(((x.length - 1) * sa * sa + (y.length - 1) * sb * sb) / (x.length + y.length - 2)) || 1e-9;
  const se = Math.sqrt(sa * sa / x.length + sb * sb / y.length) || 1e-9;
  return { diff: ma - mb, d: (ma - mb) / pooled, p: pFromZ((ma - mb) / se), na: x.length, nb: y.length, ma, mb };
}

/**
 * How much to trust a pattern. Needs enough days and a clear effect; small samples never rate
 * above Weak. Returns 'strong' | 'moderate' | 'weak' | 'none'.
 */
export function strengthOf({ r, d, p, n }) {
  const e = r != null ? Math.abs(r) : d != null ? Math.abs(d) / 2 : 0; // d of 0.8 is about r of 0.4
  if (n < 10 || e < 0.12 || p > 0.2) return 'none';
  if (e >= 0.4 && p < 0.01 && n >= 20) return 'strong';
  if (e >= 0.25 && p < 0.05 && n >= 14) return 'moderate';
  return 'weak';
}
export const STRENGTH_RANK = { strong: 3, moderate: 2, weak: 1, none: 0 };
export const STRENGTH_LABEL = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak', none: 'No link' };

/* ---------- dates ---------- */

/** Monday of the week containing iso. */
export function weekStart(iso) {
  const wd = new Date(iso + 'T12:00:00Z').getUTCDay();
  return addDays(iso, -((wd + 6) % 7));
}
export function monthStart(iso) { return iso.slice(0, 8) + '01'; }
export function addMonths(iso, n) {
  const d = new Date(iso.slice(0, 8) + '01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
export function daysInMonth(iso) {
  const d = new Date(iso.slice(0, 8) + '01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return d.getUTCDate();
}
/** Calendar cells for a month, Sunday first: leading blanks (null) then each date. */
export function monthCells(iso) {
  const first = monthStart(iso);
  const lead = new Date(first + 'T12:00:00Z').getUTCDay();
  const cells = Array.from({ length: lead }, () => null);
  for (let i = 0; i < daysInMonth(iso); i++) cells.push(addDays(first, i));
  return cells;
}
export const monthName = (iso) => new Date(iso.slice(0, 8) + '15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The calorie and macro targets that applied on a given day (the check-in in force then). */
export function targetsOn(date, { checkins, settings, current }) {
  if (settings.program === 'manual') return { ...settings.manual_targets, fiber: fiberTarget(settings.manual_targets.kcal, settings) };
  const c = (checkins || []).find(x => x.date <= date);
  return c ? { kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat, fiber: fiberTarget(c.kcal, settings) } : current;
}

/** How a logged day compares with its target: 'on' within 10%, 'over', 'under', or status words. */
export function dayVerdict(day, target, today) {
  if (day.status === 'exclude') return 'out';
  if (day.status === 'fasted') return 'fasted';
  if (!day.entries) return day.date >= today ? 'future' : 'none';
  if (day.date === today) return 'today';
  const r = day.kcal / (target.kcal || 1);
  return r > 1.1 ? 'over' : r < 0.9 ? 'under' : 'on';
}

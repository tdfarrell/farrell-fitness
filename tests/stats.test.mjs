// Insights, body fat and calendar helpers.
//   node tests/stats.test.mjs
import assert from 'node:assert/strict';
import { correlation, compareGroups, strengthOf, monthCells, weekStart, addMonths, targetsOn, dayVerdict } from '../assets/js/stats.js';
import { findInsights } from '../assets/js/views/insights.js';
import { navyBodyFat } from '../assets/js/views/body.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS', name); };

// Deterministic pseudo-random numbers.
let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / Math.sqrt(0.5); };

t('correlation of a clean line is 1 with the right slope', () => {
  const c = correlation([[1, 3], [2, 5], [3, 7], [4, 9], [5, 11]]);
  assert.ok(Math.abs(c.r - 1) < 1e-9 && Math.abs(c.slope - 2) < 1e-9 && Math.abs(c.intercept - 1) < 1e-9);
});

t('strength needs both a clear effect and enough days', () => {
  assert.equal(strengthOf({ r: 0.6, p: 0.001, n: 40 }), 'strong');
  assert.equal(strengthOf({ r: 0.6, p: 0.04, n: 8 }), 'none'); // too few days
  assert.equal(strengthOf({ r: 0.05, p: 0.7, n: 200 }), 'none');
  assert.equal(strengthOf({ r: 0.3, p: 0.03, n: 30 }), 'moderate');
});

t('group comparison', () => {
  const g = compareGroups([70, 72, 68, 75, 71], [60, 58, 63, 61, 59]);
  assert.ok(g.diff > 9 && g.d > 2 && g.p < 0.001);
});

t('insights find a planted sleep-to-calories pattern and rate random noise as no link', () => {
  const days = [];
  for (let i = 0; i < 90; i++) {
    const sleep = 5.5 + rnd() * 3;
    const date = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
    days.push({ date, weekday: new Date(date + 'T12:00:00Z').getUTCDay(), sleep, kcal: 2900 - (sleep - 5.5) * 180 + gauss() * 120,
      protein: 170 + gauss() * 15, recovery: 60 + gauss() * 12, hrv: 55 + gauss() * 6, strain: 10 + gauss() * 3, steps: 9000 + gauss() * 2500,
      lifted: i % 7 === 1 || i % 7 === 3, cardio: i % 7 === 5, mood: null, energy: null, stress: null });
  }
  const found = findInsights(days);
  const top = found[0];
  assert.equal(top.id, 'sleep_kcal');
  assert.equal(top.strength, 'strong');
  assert.match(top.title, /more that day/);
  const protein = found.find(x => x.id === 'protein_recovery');
  assert.equal(protein.strength === 'strong', false);
});

t('insights skip patterns with no data instead of inventing them', () => {
  const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, weekday: i % 7, sleep: null, kcal: 2200, protein: 170, recovery: null, hrv: null, strain: null, steps: null, lifted: false, cardio: false, mood: null }));
  const found = findInsights(days);
  assert.ok(!found.some(x => ['sleep_kcal', 'strain_recovery', 'sleep_mood', 'steps_sleep'].includes(x.id)));
});

t('US Navy body fat: typical male and female values', () => {
  const m = navyBodyFat('male', 183, 90.8, 40);
  assert.ok(m > 17 && m < 20, `male ${m}`);
  const f = navyBodyFat('female', 165, 76, 33, 100);
  assert.ok(f > 25 && f < 32, `female ${f}`);
  assert.equal(navyBodyFat('male', 183, 38, 40), null); // neck bigger than waist
});

t('calendar: October 2026 starts on Thursday, weeks start Monday', () => {
  const c = monthCells('2026-10-14');
  assert.equal(c.slice(0, 4).every(x => x === null), true);
  assert.equal(c[4], '2026-10-01');
  assert.equal(c[c.length - 1], '2026-10-31');
  assert.equal(weekStart('2026-10-25'), '2026-10-19');
  assert.equal(weekStart('2026-11-02'), '2026-11-02'); // the day after clocks change
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01');
});

t('targets in force on a past day come from the check-in at the time', () => {
  const ctx = { settings: { program: 'coached' }, current: { kcal: 2100 }, checkins: [{ date: '2026-10-19', kcal: 2150 }, { date: '2026-10-12', kcal: 2250 }] };
  assert.equal(targetsOn('2026-10-20', ctx).kcal, 2150);
  assert.equal(targetsOn('2026-10-15', ctx).kcal, 2250);
  assert.equal(targetsOn('2026-10-01', ctx).kcal, 2100);
  assert.equal(dayVerdict({ date: '2026-10-20', entries: 3, kcal: 2400, status: 'auto' }, { kcal: 2150 }, '2026-10-25'), 'over');
  assert.equal(dayVerdict({ date: '2026-10-20', entries: 3, kcal: 2100, status: 'auto' }, { kcal: 2150 }, '2026-10-25'), 'on');
  assert.equal(dayVerdict({ date: '2026-10-20', entries: 0, kcal: 0, status: 'exclude' }, { kcal: 2150 }, '2026-10-25'), 'out');
});

console.log(`\nAll ${n} stats tests passed`);

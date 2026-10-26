// Fill my macros, diet phases, nutrient targets and the drink insights.
//   node tests/nutrition.test.mjs
import assert from 'node:assert/strict';
import { suggest, fitScore, roundPortion, portionText } from '../assets/js/fill.js';
import { resolvePhases, phaseOn, proposeTargets, goalFor, withIds, TEMPLATES } from '../assets/js/phases.js';
import { defaultTarget, targetFor } from '../assets/js/nutrients.js';
import { addDays } from '../assets/js/tdee.js';
import { buildDays, findInsights } from '../assets/js/views/insights.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS', name); };

/* ---------- fill my macros ---------- */
const foods = [
  { id: 1, name: 'Chicken breast', kcal: 165, protein: 31, carbs: 0, fat: 3.6, portions: [] },
  { id: 2, name: 'Jasmine rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, portions: [{ label: '1 cup (158 g)', grams: 158 }] },
  { id: 3, name: 'Olive oil', kcal: 884, protein: 0, carbs: 0, fat: 100, portions: [{ label: '1 tbsp (14 g)', grams: 14 }] },
  { id: 4, name: 'Greek yogurt', kcal: 59, protein: 10, carbs: 3.6, fat: 0.4, portions: [{ label: '1 container (170 g)', grams: 170 }] },
  { id: 5, name: 'Salmon', kcal: 208, protein: 20, carbs: 0, fat: 13, portions: [] },
  { id: 6, name: 'Sweet potato', kcal: 86, protein: 1.6, carbs: 20, fat: 0.1, portions: [] },
  { id: 7, name: 'Water', kcal: 0, protein: 0, carbs: 0, fat: 0, portions: [] },
];
const left = { kcal: 610, protein: 45, carbs: 62, fat: 18 };

t('suggestions fit what is left closely, best first', () => {
  const s = suggest(foods, left);
  assert.ok(s.length >= 3);
  assert.ok(s[0].fit >= 85, `best fit ${s[0].fit}`);
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].cost <= s[i].cost);
  assert.ok(Math.abs(s[0].totals.kcal - 610) < 120);
});
t('no food appears in more than two suggestions, and zero-calorie foods are skipped', () => {
  const s = suggest(foods, left, { count: 6 });
  const counts = {};
  s.forEach(o => o.items.forEach(i => { counts[i.food.id] = (counts[i.food.id] || 0) + 1; }));
  assert.ok(Object.values(counts).every(c => c <= 2));
  assert.ok(!counts[7]);
});
t('one-food mode only returns single foods', () => {
  assert.ok(suggest(foods, left, { mode: 'one' }).every(o => o.items.length === 1));
});
t('portions round to half servings or 5 and 10 g steps', () => {
  assert.deepEqual(roundPortion(foods[1], 230).quantity, 1.5);
  assert.equal(roundPortion(foods[0], 133).grams, 130);
  assert.equal(roundPortion(foods[0], 22).grams, 20);
  assert.equal(portionText('1 cup (158 g)', 1.5), '1½ cups');
  assert.equal(portionText('1 serving', 0.5), '½ serving');
  assert.equal(portionText('1 container (170 g)', 2), '2 containers');
});
t('fit is 100 for an exact match and falls with misses', () => {
  assert.equal(fitScore(left, left), 100);
  assert.ok(fitScore({ kcal: 300, protein: 10, carbs: 30, fat: 10 }, left) < 60);
});

/* ---------- diet phases ---------- */
const today = '2026-10-25';
const plan = { start: '2026-10-05', items: withIds([{ type: 'lose', rate_pct: 0.5, weeks: 10 }, { type: 'break', weeks: 2 }, { type: 'lose', rate_pct: 0.5, until_kg: 80 }, { type: 'reverse', step_kcal: 75 }, { type: 'maintain' }]) };
const series = Array.from({ length: 30 }, (_, i) => ({ date: addDays('2026-09-26', i), trend: 86 - i * 0.06 }));
const ctx = { series, trendKg: 84.2, expenditure: 2640, checkins: [], today };

t('phases follow each other on the calendar', () => {
  const r = resolvePhases(plan, ctx);
  assert.equal(r.length, 5);
  assert.equal(r[0].end, '2026-12-13');
  assert.equal(r[1].start, '2026-12-14');
  assert.equal(r[1].end, '2026-12-27');
  assert.equal(r[2].start, '2026-12-28');
  assert.ok(r[2].projected && r[2].end > r[2].start);
  assert.equal(r[4].end, null);
  assert.equal(r[0].status, 'current');
  assert.equal(r[1].status, 'future');
});
t('a weight target that was already reached ends the phase on that day', () => {
  const p = { start: '2026-10-01', items: withIds([{ type: 'lose', rate_pct: 0.5, until_kg: 85 }, { type: 'maintain' }]) };
  const r = resolvePhases(p, ctx);
  const hit = series.find(s => s.date >= '2026-10-01' && s.trend <= 85).date;
  assert.equal(r[0].end, hit);
  assert.equal(r[0].status, 'past');
  assert.equal(phaseOn(r, today).type, 'maintain');
});
t('check-ins follow the running phase', () => {
  const r = resolvePhases(plan, ctx);
  const model = { expenditure: 2640, trendKg: 84.2 };
  const settings = { goal: { type: 'maintain', rate_pct: 0 }, macros: { protein_g_per_kg: 2, diet: 'balanced' } };
  const cut = proposeTargets(model, settings, [], today, r);
  assert.equal(cut.phase.type, 'lose');
  assert.ok(cut.kcal < 2300 && cut.kcal > 2100, `cut kcal ${cut.kcal}`);
  const brk = proposeTargets(model, settings, [], '2026-12-15', r);
  assert.equal(brk.kcal, 2640);
});
t('a reverse diet adds its step to the last check-in, up to expenditure', () => {
  const p = { start: '2026-10-01', items: withIds([{ type: 'reverse', step_kcal: 75 }, { type: 'maintain' }]) };
  const model = { expenditure: 2640, trendKg: 84 };
  const settings = { goal: { type: 'lose', rate_pct: 0.5 }, macros: { protein_g_per_kg: 2, diet: 'balanced' } };
  const r = resolvePhases(p, { ...ctx, checkins: [{ date: '2026-10-19', kcal: 2200, expenditure: 2640 }] });
  assert.equal(proposeTargets(model, settings, [{ kcal: 2200 }], today, r).kcal, 2275);
  assert.equal(proposeTargets(model, settings, [{ kcal: 2600 }], today, r).kcal, 2640);
});
t('no plan means your usual goal', () => {
  const model = { expenditure: 2500, trendKg: 80 };
  const settings = { goal: { type: 'maintain', rate_pct: 0 }, macros: { protein_g_per_kg: 2, diet: 'balanced' } };
  assert.equal(proposeTargets(model, settings, [], today, []).kcal, 2500);
  assert.deepEqual(goalFor({ type: 'break' }), { type: 'maintain', rate_pct: 0 });
  assert.ok(TEMPLATES.every(x => x.items[x.items.length - 1].type === 'maintain'));
});

/* ---------- nutrient targets ---------- */
t('nutrient targets depend on sex and age, and your own override them', () => {
  const now = new Date().getFullYear();
  assert.equal(defaultTarget('fiber', { sex: 'male', birth_year: now - 40 }, 2150), 30);
  assert.equal(defaultTarget('fiber', { sex: 'female', birth_year: now - 60 }), 28);
  assert.equal(defaultTarget('iron', { sex: 'female', birth_year: now - 30 }), 18);
  assert.equal(defaultTarget('sat_fat', {}, 2700), 30);
  assert.equal(defaultTarget('sugar', {}), null);
  assert.equal(targetFor('sodium', { nutrient_targets: { sodium: 1500 } }), 1500);
});

/* ---------- drink insights ---------- */
t('alcohol and late caffeine patterns', () => {
  const days = [], extra = {};
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 60; i++) {
    const date = addDays('2026-08-01', i);
    const drinks = i % 4 === 0 ? 3 : 0;
    const late = i % 3 === 0 ? 100 : 0;
    const prev = days[i - 1];
    const prevDrinks = i > 0 && (i - 1) % 4 === 0;
    const prevLate = i > 0 && (i - 1) % 3 === 0;
    days.push({ date, entries: 0, status: 'auto', whoop: { hrv: (prevDrinks ? 48 : 60) + rnd() * 4, recovery: (prevDrinks ? 50 : 70) + rnd() * 5, sleep_hours: (prevLate ? 6.4 : 7.4) + rnd() * 0.2 } });
    extra[date] = { drinks: { alcohol: drinks, caffeine: 200 + late, late_caffeine: late, water: 2000 } };
    void prev;
  }
  const found = findInsights(buildDays(days, extra, '2026-12-01'));
  const hrv = found.find(f => f.id === 'alcohol_hrv');
  const sleep = found.find(f => f.id === 'caffeine_sleep');
  assert.ok(hrv && /lower/.test(hrv.title) && hrv.strength !== 'none', hrv?.title);
  assert.ok(sleep && /less/.test(sleep.title), sleep?.title);
  assert.ok(found.find(f => f.id === 'alcohol_recovery'));
});
t('drinks are unknown before you start logging them', () => {
  const d = buildDays([{ date: '2026-08-01', entries: 0 }, { date: '2026-08-02', entries: 0 }], { '2026-08-02': { drinks: { alcohol: 1 } } }, '2026-09-01');
  assert.equal(d[0].alcohol, null);
  assert.equal(d[1].alcohol, 1);
});

console.log(`\nAll ${n} nutrition tests passed`);

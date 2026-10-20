// Run: node tests/tdee.test.mjs
import assert from 'node:assert/strict';
import { computeModel, targetsFor, weightTrend, addDays, checkinStatus, intakeFor } from '../assets/js/tdee.js';

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / Math.sqrt(0.5); };

function simulate({ days = 84, start = '2026-07-01', trueE = (i) => 2800, intake = (i) => 2300, kg = 90, noise = 0.6, logRate = 0.9 }) {
  const out = [];
  let mass = kg;
  for (let i = 0; i < days; i++) {
    const kcal = Math.round(intake(i) + gauss() * 150);
    const logged = rnd() < logRate;
    out.push({ date: addDays(start, i), entries: logged ? 4 : 0, kcal: logged ? kcal : 0, status: 'auto',
      weight_kg: rnd() < 0.85 ? +(mass + gauss() * noise).toFixed(1) : null });
    mass += (kcal - trueE(i)) / 7700;
  }
  return out;
}
const settings = { sex: 'male', birth_year: 1985, height_cm: 180, activity: 'sedentary', goal: { type: 'lose', rate_pct: 0.5 }, macros: { protein_g_per_kg: 2, diet: 'balanced' }, checkin_weekday: 1 };

// 1. Converges to true expenditure from a poor starting guess.
const d1 = simulate({});
const today1 = addDays(d1[d1.length - 1].date, 1);
const m1 = computeModel(d1, settings, today1);
console.log('prior', m1.prior, 'est after 12 wk', Math.round(m1.expenditure), 'trend', m1.trendKg.toFixed(1), 'wk', m1.weeklyChangeKg.toFixed(2));
assert.ok(Math.abs(m1.expenditure - 2800) < 150, 'converges near 2800');

// 2. Tracks a drop in expenditure (adaptation) within ~5 weeks.
const d2 = simulate({ days: 126, trueE: i => (i < 63 ? 2900 : 2600) });
const m2 = computeModel(d2, settings, addDays(d2[d2.length - 1].date, 1));
console.log('after drop to 2600:', Math.round(m2.expenditure));
assert.ok(Math.abs(m2.expenditure - 2600) < 170);

// 3. Sparse logging (40%) still produces a sane number.
const d3 = simulate({ logRate: 0.4 });
const m3 = computeModel(d3, settings, addDays(d3[d3.length - 1].date, 1));
console.log('sparse logging:', Math.round(m3.expenditure));
assert.ok(m3.expenditure > 2300 && m3.expenditure < 3300);

// 4. Targets: deficit matches goal rate, macros add up.
const t = targetsFor(2840, 89.1, settings);
const kcalFromMacros = t.protein * 4 + t.carbs * 4 + t.fat * 9;
console.log('targets', t, 'macro kcal', kcalFromMacros);
assert.ok(Math.abs(kcalFromMacros - t.kcal) < 15);
assert.equal(t.protein, 178);
assert.ok(Math.abs((2840 - t.kcal) - (0.005 * 89.1 * 7700 / 7)) < 5);
const keto = targetsFor(2500, 80, { ...settings, goal: { type: 'maintain' }, macros: { protein_g_per_kg: 1.8, diet: 'keto' } });
assert.equal(keto.carbs, 30);
assert.equal(keto.kcal, 2500);

// 5. Trend fills gaps and ignores today; intake rules.
const tr = weightTrend([{ weight_kg: 90 }, {}, {}, { weight_kg: 89.4 }]);
assert.ok(tr[1] < 90 && tr[3] < tr[2]);
assert.equal(intakeFor({ date: '2026-10-20', entries: 3, kcal: 900 }, '2026-10-20'), null);
assert.equal(intakeFor({ date: '2026-10-19', entries: 0, kcal: 0, status: 'fasted' }, '2026-10-20'), 0);
assert.equal(intakeFor({ date: '2026-10-19', entries: 2, kcal: 900, status: 'exclude' }, '2026-10-20'), null);

// 6. Check-in schedule lands on the chosen weekday.
const cs = checkinStatus([{ date: '2026-10-12' }], { checkin_weekday: 1 }, '2026-10-19');
assert.equal(cs.next, '2026-10-19'); assert.equal(cs.due, true);
const cs2 = checkinStatus([{ date: '2026-10-16' }], { checkin_weekday: 1 }, '2026-10-19');
assert.equal(cs2.next, '2026-10-23'); assert.equal(cs2.due, false);
console.log('all tdee tests passed');

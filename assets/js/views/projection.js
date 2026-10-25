// Goal projection: where your trend weight is headed, when you'd reach a goal weight at different
// rates, and what each rate means for daily calories.
import { h, fmt0, fmt1, todayISO, shortDate, toast } from '../ui.js';
import { post } from '../api.js';
import { state, loadSummary, fmtW, wUnit, toDisplayW, fromDisplayW, markStale } from '../store.js';
import { pageHead } from '../components.js';
import { chart } from '../charts.js';
import { addDays, targetsFor } from '../tdee.js';

const RATES = [0.25, 0.5, 0.75, 1];
let pick = null;
let goalInput = null;

const md = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: iso.slice(0, 4) !== todayISO().slice(0, 4) ? 'numeric' : undefined });

export async function render(root) {
  await loadSummary();
  const { model, settings } = state;
  const today = todayISO();
  const trend = model.trendKg;
  if (trend == null) {
    root.replaceChildren(pageHead("Where you're headed", 'Goal projection'),
      h('section', { class: 'card' }, h('p', { class: 'note' }, 'Log your weight for a few days and your projection appears here.'), h('a', { class: 'btn primary', href: '#/weight', style: { alignSelf: 'flex-start' } }, 'Log weight')));
    return;
  }
  const savedGoal = settings.goal.target_kg;
  const goalKg = goalInput ?? savedGoal ?? (settings.goal.type === 'gain' ? trend * 1.05 : trend * 0.92);
  const dir = goalKg < trend - 0.05 ? -1 : goalKg > trend + 0.05 ? 1 : 0;
  pick ??= RATES.includes(+settings.goal.rate_pct) ? +settings.goal.rate_pct : 0.5;
  const refresh = () => render(root);

  const plan = (pct) => {
    const perWeek = (pct / 100) * trend;
    const weeks = dir ? Math.abs(goalKg - trend) / perWeek : 0;
    const date = addDays(today, Math.round(weeks * 7));
    const kcal = targetsFor(model.expenditure, trend, { ...settings, goal: { type: dir < 0 ? 'lose' : dir > 0 ? 'gain' : 'maintain', rate_pct: pct } }).kcal;
    return { pct, perWeek, weeks, date, kcal };
  };
  const cur = plan(pick);
  const actual = model.monthlyRateKg; // kg per week over the last 4 weeks
  const actualWeeks = dir && actual && Math.sign(actual) === dir ? Math.abs(goalKg - trend) / Math.abs(actual) : null;

  const goalIn = h('input', { id: 'pj-goal', inputmode: 'decimal', value: fmt1(toDisplayW(goalKg)), onchange: (e) => {
    const v = parseFloat(e.target.value.replace(',', '.'));
    if (!v) return;
    goalInput = fromDisplayW(v);
    refresh();
  } });

  const hero = h('div', { class: 'proj-hero' },
    dir === 0 ? [h('span', { class: 'small on-deep-muted' }, 'Your goal'), h('span', { class: 'num', style: { fontSize: '34px' } }, "You're there"), h('span', { class: 'small on-deep-muted' }, 'Set maintenance in Settings to hold this weight.')]
      : [h('span', { class: 'small on-deep-muted' }, `At ${pick}% of body weight a week`),
        h('span', { class: 'num', style: { fontSize: '34px' } }, cur.weeks > 104 ? 'Over 2 years' : `About ${md(cur.date)}`),
        h('span', { class: 'small on-deep-muted' }, `${fmt0(cur.weeks)} weeks at ${dir < 0 ? '−' : '+'}${fmt1(toDisplayW(cur.perWeek))} ${wUnit()} a week.` +
          (actual != null ? (actualWeeks != null ? ` Your last 4 weeks averaged ${actual < 0 ? '−' : '+'}${fmt1(Math.abs(toDisplayW(actual)))}, which would mean about ${md(addDays(today, Math.round(actualWeeks * 7)))}.`
            : ` Your last 4 weeks moved ${actual < 0 ? 'down' : 'up'} ${fmt1(Math.abs(toDisplayW(actual)))} a week, away from this goal.`) : ''))]);

  // Chart: the last 12 weeks of trend, then the projection to the goal (weekly points).
  const hist = [];
  for (let k = 12; k >= 0; k--) { const d = addDays(today, -7 * k); const s = model.series.filter(x => x.date <= d && x.trend != null).pop(); hist.push({ date: d, v: s?.trend ?? null }); }
  const projWeeks = dir ? Math.min(Math.ceil(cur.weeks), 52) : 0;
  const proj = Array.from({ length: projWeeks }, (_, i) => ({ date: addDays(today, 7 * (i + 1)), v: trend + dir * cur.perWeek * Math.min(i + 1, cur.weeks) }));
  const pts = [...hist, ...proj];
  const nowI = hist.length - 1;
  const ticks = [{ i: 0, text: md(pts[0].date) }, { i: nowI, text: 'Today' }];
  if (proj.length) ticks.push({ i: pts.length - 1, text: cur.weeks > 52 ? md(pts[pts.length - 1].date) : md(cur.date) });
  const graph = chart({ n: pts.length, w: 640, h: 190,
    lines: [{ values: pts.map((p, i) => (i <= nowI ? toDisplayW(p.v) : null)), color: 'var(--primary)', endDot: true },
      { values: pts.map((p, i) => (i >= nowI ? toDisplayW(i === nowI ? trend : p.v) : null)), color: 'var(--kcal)', dash: '6 5' }],
    hline: { value: toDisplayW(goalKg), color: 'var(--green)' }, xLabels: ticks, yFormat: fmt0,
    label: `Trend weight for 12 weeks, then projected to ${fmtW(goalKg)} ${wUnit()}${dir ? ` around ${md(cur.date)}` : ''}` });

  const rows = RATES.map(plan);
  const table = h('div', { class: 'proj-table', role: 'table', 'aria-label': 'Rates compared' },
    h('div', { class: 'pt-row head', role: 'row' }, ['Rate', 'Per week', 'Calories', 'Reach goal'].map(x => h('span', { role: 'columnheader' }, x))),
    rows.map(r => h('button', { class: 'pt-row' + (r.pct === pick ? ' sel' : ''), role: 'row', 'aria-pressed': String(r.pct === pick), onclick: () => { pick = r.pct; refresh(); } },
      h('span', { role: 'cell' }, `${r.pct}%`), h('span', { role: 'cell' }, `${dir < 0 ? '−' : '+'}${fmt1(toDisplayW(r.perWeek))} ${wUnit()}`),
      h('span', { role: 'cell' }, fmt0(r.kcal)), h('span', { role: 'cell' }, dir ? (r.weeks > 104 ? '2+ years' : md(r.date)) : '-'))));

  const saveBtn = h('button', { class: 'btn primary block', onclick: async () => {
    try {
      await post('settings', { goal: { type: dir < 0 ? 'lose' : dir > 0 ? 'gain' : 'maintain', rate_pct: pick, target_kg: Math.round(goalKg * 100) / 100 } });
      markStale(); goalInput = null; toast('Goal saved. Your next check-in uses this rate.'); refresh();
    } catch (e) { toast(e.message, 'error'); }
  } }, 'Set goal and rate');

  root.replaceChildren(
    pageHead("Where you're headed", 'Goal projection'),
    h('div', { class: 'row' },
      h('section', { class: 'card grow-3', 'aria-label': 'Projection' },
        h('div', { class: 'grid-2', style: { alignItems: 'end' } },
          h('label', { class: 'field', for: 'pj-goal' }, `Goal weight (${wUnit()})`, goalIn),
          h('div', { class: 'stat' }, h('span', { class: 'label' }, 'Trend today'), h('span', { class: 'num', style: { fontSize: '26px' } }, `${fmtW(trend)} ${wUnit()}`),
            h('span', { class: 'small muted' }, dir ? `${fmt1(Math.abs(toDisplayW(goalKg - trend)))} ${wUnit()} to ${dir < 0 ? 'lose' : 'gain'}` : 'At your goal'))),
        hero, graph),
      h('section', { class: 'card grow-2', 'aria-label': 'Try a different rate' },
        h('div', { class: 'card-head' }, h('h2', null, 'What if'), h('span', { class: 'small muted' }, '% of body weight per week')),
        h('input', { type: 'range', min: 0.25, max: 1, step: 0.25, value: pick, 'aria-label': 'Rate per week', class: 'rate-range', oninput: (e) => { pick = +e.target.value; refresh().then(() => root.querySelector('.rate-range')?.focus()); } }),
        table,
        h('p', { class: 'note small' }, `Calories use your current expenditure estimate of ${fmt0(model.expenditure)} and will shift as it updates. Faster rates make it harder to keep muscle${dir > 0 ? ' lean' : ''}.`),
        saveBtn,
        savedGoal != null && Math.abs(savedGoal - goalKg) < 0.01 && +settings.goal.rate_pct === pick ? h('p', { class: 'tiny muted', style: { textAlign: 'center' } }, 'This is your current goal.') : null)));
}

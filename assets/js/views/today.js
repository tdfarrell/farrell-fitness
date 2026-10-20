import { h, icon, fmt0, fmt1, signed, longDate, todayISO, recoveryColor, relDay } from '../ui.js';
import { get } from '../api.js';
import { state, loadSummary, fmtW, wUnit, toDisplayW } from '../store.js';
import { pageHead, calorieCard, whoopCard } from '../components.js';
import { chart, sparkline, dateTicks } from '../charts.js';
import { openWeightSheet } from './weight.js';
import { openAddFood } from './food.js';

export async function render(root) {
  await loadSummary();
  const today = todayISO();
  const { summary, model, targets, checkin, settings } = state;
  const days = summary.days;
  const tday = days[days.length - 1];
  const totals = { kcal: tday.kcal, protein: tday.protein, carbs: tday.carbs, fat: tday.fat };
  const w = tday.whoop || days[days.length - 2]?.whoop || null;
  const recent7 = days.slice(-7).map(d => d.whoop?.recovery).filter(v => v != null);
  const avgRec = recent7.length ? recent7.reduce((a, b) => a + b, 0) / recent7.length : null;

  const workoutsRes = await get('workouts', { from: days[Math.max(0, days.length - 14)].date, to: today }).catch(() => ({ workouts: [], whoop: [] }));
  const s28 = model.series.slice(-28);
  const s56 = model.series.slice(-56);

  const logFood = () => openAddFood({ date: today, meal: guessMeal(settings), onDone: () => rerender(root) });

  const head = pageHead(longDate(today), 'Today', [
    w?.recovery != null ? h('a', { class: 'chip-btn phone-only', href: '#/whoop', 'aria-label': `Recovery ${w.recovery} percent, open WHOOP details` },
      h('span', { class: 'dot', style: { background: recoveryColor(w.recovery) }, 'aria-hidden': 'true' }), `Recovery ${w.recovery}%`) : null,
    h('a', { class: 'icon-btn phone-only', href: '#/settings', 'aria-label': 'Settings' }, icon('settings')),
    h('button', { class: 'btn sm desk-only', onclick: () => openWeightSheet({ onDone: () => rerender(root) }) }, 'Log weight'),
    h('a', { class: 'btn sm desk-only', href: '#/train/new' }, 'Start workout'),
    h('button', { class: 'btn sm primary desk-only', onclick: logFood }, 'Log food'),
  ]);

  const kcalCard = calorieCard(totals, targets, {
    class: 'grow-3',
    expenditure: model.expenditure,
    action: h('button', { class: 'btn primary block phone-only', onclick: logFood }, icon('plus', 18), 'Log food'),
  });

  const firstRun = !model.hasData;
  const intro = firstRun ? h('section', { class: 'card', 'aria-label': 'Getting started' },
    h('h2', null, 'Getting started'),
    h('p', { class: 'note' }, 'Log your weight each morning and everything you eat. After about two weeks your expenditure estimate is built from your own data, and weekly check-ins set your targets from it.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn sm', onclick: () => openWeightSheet({ onDone: () => rerender(root) }) }, 'Log weight'),
      h('a', { class: 'btn sm', href: '#/settings' }, 'Set your goal'))) : null;

  // Phone: two small cards with sparklines.
  const smallCards = h('div', { class: 'grid-2 phone-only' },
    h('a', { class: 'card', href: '#/progress', style: { textDecoration: 'none', color: 'inherit', gap: '4px' }, 'aria-label': 'Expenditure' },
      h('span', { class: 'small muted', style: { fontWeight: 500 } }, 'Expenditure'),
      h('span', { class: 'num', style: { fontSize: '34px' } }, fmt0(model.expenditure)),
      h('span', { class: 'small muted' }, weekChangeText(model)),
      sparkline(s28.map(s => s.expenditure), 'var(--blue)', 'Expenditure over the last 4 weeks')),
    h('a', { class: 'card', href: '#/weight', style: { textDecoration: 'none', color: 'inherit', gap: '4px' }, 'aria-label': 'Trend weight' },
      h('span', { class: 'small muted', style: { fontWeight: 500 } }, 'Trend weight'),
      h('span', { class: 'num', style: { fontSize: '34px' } }, fmtW(model.trendKg), h('span', { class: 'unit' }, ` ${wUnit()}`)),
      h('span', { class: 'small muted' }, model.weeklyChangeKg == null ? 'Log weight daily' : `${model.weeklyChangeKg <= 0 ? 'down' : 'up'} ${fmt1(Math.abs(toDisplayW(model.weeklyChangeKg)))} ${wUnit()}/week`),
      sparkline(s28.map(s => toDisplayW(s.trend)), 'var(--ink)', 'Trend weight over the last 4 weeks')));

  // Desktop: full charts.
  const wDates = s56.map(s => s.date);
  const weightChart = h('section', { class: 'card grow-3 desk-only', style: { flexDirection: 'column' }, 'aria-label': 'Weight trend' },
    h('div', { class: 'card-head' }, h('h2', null, 'Weight, last 8 weeks'),
      h('span', { class: 'muted', style: { fontSize: '14px' } }, h('strong', { style: { color: 'var(--ink)', fontWeight: 600 } }, `${fmtW(model.trendKg)} ${wUnit()}`), ' trend, ', weeklyRateText(model))),
    chart({ n: s56.length, w: 640, h: 220, dots: [{ values: s56.map(s => toDisplayW(s.weight)) }],
      lines: [{ values: s56.map(s => toDisplayW(s.trend)), color: 'var(--blue)', endDot: true }],
      xLabels: dateTicks(wDates), yFormat: (v) => fmt0(v), label: 'Scale weights and smoothed trend over 8 weeks' }));

  const s84 = model.series.slice(-84);
  const whoopKcal = days.slice(-84).map(d => d.whoop?.kcal ?? null);
  const hasWhoopKcal = whoopKcal.some(v => v != null);
  const last14Whoop = days.slice(-15, -1).map(d => d.whoop?.kcal).filter(v => v != null);
  const expChart = h('section', { class: 'card grow-2 desk-only', style: { flexDirection: 'column' }, 'aria-label': 'Expenditure' },
    h('h2', null, 'Expenditure'),
    h('div', { style: { display: 'flex', gap: '28px' } },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '34px', color: 'var(--blue)' } }, fmt0(model.expenditure)), h('span', { class: 'label', style: { fontSize: '13px' } }, 'adaptive estimate')),
      last14Whoop.length ? h('div', { class: 'stat' }, h('span', { class: 'num muted', style: { fontSize: '34px' } }, fmt0(avg(last14Whoop))), h('span', { class: 'label', style: { fontSize: '13px' } }, 'WHOOP, 14-day avg')) : null),
    chart({ n: s84.length, w: 400, h: 180, lines: [
      ...(hasWhoopKcal ? [{ values: smooth(whoopKcal, 7), color: 'var(--dot)', width: 2, dash: '5 4' }] : []),
      { values: s84.map(s => s.expenditure), color: 'var(--blue)' }],
      xLabels: dateTicks(s84.map(s => s.date), 3), yFormat: fmt0, label: 'Adaptive expenditure estimate over 12 weeks' + (hasWhoopKcal ? ', with WHOOP calories for comparison' : '') }),
    h('p', { class: 'note small' }, 'Targets use the adaptive estimate, which comes from your intake and weight trend.' + (hasWhoopKcal ? " WHOOP's number is shown for comparison." : '')));

  const d14 = days.slice(-14);
  const logged14 = d14.slice(0, -1).filter(d => d.entries > 0);
  const intakeChart = h('section', { class: 'card grow-3 desk-only', style: { flexDirection: 'column' }, 'aria-label': 'Intake, last 14 days' },
    h('div', { class: 'card-head' }, h('h2', null, 'Intake, last 14 days'),
      h('span', { class: 'muted', style: { fontSize: '14px' } }, logged14.length ? `Avg ${fmt0(avg(logged14.map(d => d.kcal)))} kcal, ${logged14.length} of ${d14.length - 1} days logged` : 'No days logged yet')),
    chart({ n: d14.length, w: 640, h: 170, yMin: 0,
      bars: [{ values: d14.map(d => (d.entries > 0 ? d.kcal : null)), colorFn: (v, i) => (i === d14.length - 1 ? 'var(--soft-blue)' : 'var(--blue)'), emptyColor: 'var(--ground)' }],
      hline: { value: targets.kcal }, xLabels: dateTicks(d14.map(d => d.date), 3), yFormat: fmt0,
      label: `Daily intake for 14 days against the ${fmt0(targets.kcal)} calorie target` }));

  const sessions = [
    ...workoutsRes.workouts.map(wk => ({ date: wk.date, name: wk.name, meta: `${relDay(wk.date)}${wk.duration_min ? `, ${wk.duration_min} min` : ''}, ${wk.set_count} sets`, href: `#/train/${wk.id}` })),
    ...workoutsRes.whoop.filter(x => !/strength|weightlifting|functional/i.test(x.sport || '')).map(x => ({ date: x.date, name: x.sport, meta: `${relDay(x.date)}, from WHOOP`, strain: x.strain })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const strainByDate = Object.fromEntries(workoutsRes.whoop.map(x => [x.date, x.strain]));
  const trainingCard = h('section', { class: 'card grow-2', 'aria-label': 'Training' },
    h('div', { class: 'card-head' }, h('h2', null, 'Training'), h('span', { class: 'muted', style: { fontSize: '14px' } }, `${workoutsRes.workouts.filter(x => x.date > days[days.length - 8].date).length} sessions this week`)),
    sessions.length
      ? h('div', { class: 'list' }, sessions.map(s => h(s.href ? 'a' : 'div', { class: 'list-row', href: s.href, style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'main' }, h('span', { class: 'title' }, s.name), h('span', { class: 'small muted' }, s.meta)),
          (s.strain ?? strainByDate[s.date]) != null ? h('div', { class: 'stat', style: { alignItems: 'flex-end' } }, h('span', { style: { fontWeight: 600 } }, fmt1(s.strain ?? strainByDate[s.date])), h('span', { class: 'tiny muted' }, 'WHOOP strain')) : null)))
      : h('p', { class: 'note' }, 'No sessions in the last two weeks.'),
    h('a', { class: 'btn sm', href: '#/train/new', style: { alignSelf: 'flex-start' } }, 'Start workout'));

  const checkinLink = h('a', { class: 'linkcard', href: '#/progress' },
    h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      h('span', { style: { fontWeight: 600 } }, checkin.due ? 'Your weekly check-in is ready' : settings.program === 'manual' ? 'Progress and check-ins' : `Weekly check-in is ${relDay(checkin.next) === 'Today' ? 'today' : weekdayName(checkin.next)}`),
      h('span', { class: 'small muted' }, `${days.slice(-8, -1).filter(d => d.entries > 0).length} of 7 days logged this week`)),
    icon('right', 20));

  root.replaceChildren(
    head,
    h('div', { class: 'stack' },
      intro,
      checkin.due ? checkinLink : null,
      h('div', { class: 'row' }, kcalCard, h('div', { class: 'grow-2', style: { display: 'flex' } }, whoopCard(w, summary.whoop, avgRec))),
      smallCards,
      h('div', { class: 'row desk-only' }, weightChart, expChart),
      h('div', { class: 'row' }, intakeChart, trainingCard),
      checkin.due ? null : checkinLink));
  root.querySelector('.whoop-card')?.style.setProperty('flex', '1');
}

function rerender(root) { state.stale = true; render(root); }
function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function smooth(vals, k) {
  return vals.map((v, i) => {
    const win = vals.slice(Math.max(0, i - k + 1), i + 1).filter(x => x != null);
    return v == null && !win.length ? null : win.length ? avg(win) : null;
  });
}
function weekChangeText(model) {
  const s = model.series.filter(x => x.expenditure != null);
  if (s.length < 8) return 'kcal/day, starting estimate';
  const d = s[s.length - 1].expenditure - s[s.length - 8].expenditure;
  return `kcal/day, ${Math.abs(d) < 5 ? 'steady' : (d > 0 ? 'up ' : 'down ') + fmt0(Math.abs(d))} this week`;
}
function weeklyRateText(model) {
  if (model.weeklyChangeKg == null) return 'log daily to see your rate';
  return `${signed(toDisplayW(model.weeklyChangeKg))} ${wUnit()}/wk`;
}
function weekdayName(iso) { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }); }
export function guessMeal(settings) {
  const meals = settings?.meals || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  const hr = new Date().getHours();
  const idx = hr < 10 ? 0 : hr < 15 ? 1 : hr < 21 ? 2 : 3;
  return meals[Math.min(idx, meals.length - 1)];
}

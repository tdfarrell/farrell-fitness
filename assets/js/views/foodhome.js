// Food overview: today at a glance, calorie and macro trends, a month calendar and recent days.
import { h, icon, fmt0, todayISO, shortDate, relDay } from '../ui.js';
import { get } from '../api.js';
import { state, loadSummary } from '../store.js';
import { pageHead, plateBar } from '../components.js';
import { chart, dateTicks } from '../charts.js';
import { addDays } from '../tdee.js';
import { mean, monthCells, monthName, addMonths, monthStart, targetsOn, dayVerdict, weekStart } from '../stats.js';
import { openAddFood, foodSwitch } from './food.js';
import { guessMeal } from './today.js';

let span = 30;
let month = null;

const VERDICT = {
  on: ['On target', 'v-on'], over: ['Over', 'v-over'], under: ['Under', 'v-under'], none: ['Not logged', 'v-none'],
  out: ['Left out', 'v-out'], fasted: ['Fasted', 'v-fasted'], today: ['Today', 'v-today'], future: ['', 'v-future'],
};

export async function render(root) {
  await loadSummary();
  const { summary, model, targets, settings } = state;
  const today = todayISO();
  const days = summary.days;
  const ctx = { checkins: summary.checkins, settings, current: targets };
  const top = await get('foods/top', { from: addDays(today, -30), to: today }).catch(() => ({ foods: [] }));
  const refresh = () => render(root);
  month ??= monthStart(today);

  const tday = days[days.length - 1];
  const left = targets.kcal - tday.kcal;
  const todayCard = h('a', { class: 'card linkish today-food', href: '#/food/diary', 'aria-label': `Today, ${fmt0(Math.abs(left))} calories ${left >= 0 ? 'left' : 'over'}. Open today's diary` },
    h('div', { class: 'card-head', style: { alignItems: 'flex-end' } },
      h('span', { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { class: 'small muted', style: { fontWeight: 500 } }, left >= 0 ? 'Today, calories left' : 'Today, calories over'),
        h('span', { class: 'num', style: { fontSize: '40px', color: left >= 0 ? 'var(--kcal)' : 'var(--red)' } }, fmt0(Math.abs(left)))),
      h('span', { class: 'open-link' }, 'Open diary', icon('right', 16))),
    plateBar(tday, targets.kcal),
    h('span', { class: 'small muted' }, `${fmt0(tday.protein)} g protein, ${fmt0(tday.carbs)} g carbs, ${fmt0(tday.fat)} g fat so far`));

  // Completed days in the chosen span (today is still in progress).
  const past = days.filter(d => d.date < today).slice(-span);
  const logged = past.filter(d => d.entries > 0 && d.status !== 'exclude');
  const avgKcal = mean(logged.map(d => d.kcal));
  const expByDate = Object.fromEntries(model.series.map(s => [s.date, s.expenditure]));
  const calCard = h('section', { class: 'card', 'aria-label': `Calories, last ${span} days` },
    h('div', { class: 'card-head', style: { alignItems: 'flex-end' } },
      h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('h2', null, 'Calories'),
        h('span', { class: 'small muted' }, avgKcal != null ? `Average ${fmt0(avgKcal)} on ${logged.length} logged days` : 'Nothing logged in this range')),
      h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Range' },
        [[7, '7D'], [30, '30D'], [90, '90D']].map(([d, l]) => h('button', { role: 'tab', 'aria-selected': String(span === d), onclick: () => { span = d; refresh(); } }, l)))),
    chart({ n: past.length, w: 720, h: 190, yMin: 0,
      bars: [{ values: past.map(d => (d.status === 'exclude' ? null : d.entries > 0 || d.status === 'fasted' ? d.kcal : null)), color: 'var(--kcal)',
        emptyColor: 'var(--rule)' }],
      lines: [
        { values: past.map(d => targetsOn(d.date, ctx).kcal), color: 'var(--ink)', width: 2, dash: '6 4' },
        { values: past.map(d => expByDate[d.date] ?? null), color: 'var(--primary)', width: 2.5 },
      ],
      xLabels: dateTicks(past.map(d => d.date), span <= 7 ? 3 : 4), yFormat: fmt0,
      label: `Daily calories for the last ${span} days. Average ${fmt0(avgKcal)}. Dashed line is the target, solid line is expenditure.` }),
    h('div', { class: 'legend' },
      h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '2px', background: 'var(--kcal)' } }), 'Eaten'),
      h('span', null, h('i', { style: { width: '16px', borderTop: '2px dashed var(--ink)' } }), 'Target'),
      h('span', null, h('i', { style: { width: '16px', height: '3px', background: 'var(--primary)' } }), 'Expenditure'),
      h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '2px', background: 'var(--rule)' } }), 'Not logged or left out')));

  // Macros: averages over logged days, how often each landed near its target, and a weekly trend.
  const weeks = [];
  for (let k = 3; k >= 0; k--) { const s = addDays(weekStart(addDays(today, -1)), -7 * k); weeks.push(s); }
  const macro = (key, name, cls, tol) => {
    const vals = logged.map(d => d[key]);
    const hits = logged.filter(d => Math.abs(d[key] - targetsOn(d.date, ctx)[key]) <= Math.max(tol, targetsOn(d.date, ctx)[key] * 0.1)).length;
    const byWeek = weeks.map(ws => mean(days.filter(d => d.date >= ws && d.date < addDays(ws, 7) && d.date < today && d.entries > 0 && d.status !== 'exclude').map(d => d[key])));
    // Scale to the spread of the weeks (and the target) so week-to-week changes are visible.
    const known = [...byWeek.filter(v => v != null), targets[key]];
    const lo = Math.min(...known) * 0.9, hi = Math.max(...known);
    const barH = (v) => 10 + ((v - lo) / Math.max(1, hi - lo)) * 38;
    return h('div', { class: 'macro-trend' },
      h('span', { class: 'mt-main' },
        h('span', { class: 'name small', style: { fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' } }, h('span', { class: 'swatch ' + cls, 'aria-hidden': 'true' }), name),
        h('span', { class: 'num', style: { fontSize: '24px' } }, fmt0(mean(vals)), h('span', { class: 'unit' }, ` / ${fmt0(targets[key])} g`)),
        h('span', { class: 'tiny muted' }, logged.length ? `Near target on ${hits} of ${logged.length} days` : 'No logged days')),
      h('div', { class: 'mini-bars', role: 'img', 'aria-label': `${name} daily average by week: ${byWeek.map(v => (v == null ? 'none' : fmt0(v))).join(', ')} grams` },
        byWeek.map(v => h('div', { class: cls, style: { height: `${v == null ? 0 : barH(v)}px`, opacity: v == null ? 0 : 1 } }))));
  };
  const kp = mean(logged.map(d => d.protein * 4)), kc = mean(logged.map(d => d.carbs * 4)), kf = mean(logged.map(d => d.fat * 9));
  const tot = (kp || 0) + (kc || 0) + (kf || 0) || 1;
  const fiber = mean(logged.map(d => d.fiber || null));
  const macroCard = h('section', { class: 'card', 'aria-label': 'Macros' },
    h('div', { class: 'card-head' }, h('h2', null, 'Macros'), h('span', { class: 'small muted' }, 'daily average, bars by week')),
    macro('protein', 'Protein', 'c-protein', 10), macro('carbs', 'Carbs', 'c-carbs', 15), macro('fat', 'Fat', 'c-fat', 6),
    h('div', { class: 'grid-3', style: { borderTop: '1px solid var(--rule)', paddingTop: '12px' } },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '20px' } }, fiber != null ? `${fmt0(fiber)} g` : '-'), h('span', { class: 'label' }, 'Fiber a day')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '20px' } }, logged.length ? `${fmt0(kp / tot * 100)} / ${fmt0(kc / tot * 100)} / ${fmt0(kf / tot * 100)}` : '-'), h('span', { class: 'label' }, '% protein / carbs / fat')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '20px' } }, `${logged.length} of ${past.length}`), h('span', { class: 'label' }, 'Days logged'))));

  // Month calendar.
  const byDate = Object.fromEntries(days.map(d => [d.date, d]));
  const firstData = days.find(d => d.entries > 0)?.date || today;
  const cells = monthCells(month).map(iso => {
    if (!iso) return h('span', { 'aria-hidden': 'true' });
    const d = byDate[iso] || { date: iso, entries: 0, kcal: 0, status: 'auto' };
    const v = iso > today ? 'future' : dayVerdict(d, targetsOn(iso, ctx), today);
    const [word, cls] = VERDICT[v];
    const n = Number(iso.slice(8));
    const label = `${shortDate(iso)}${d.entries ? `, ${fmt0(d.kcal)} kcal` : ''}${word ? `, ${word.toLowerCase()}` : ''}`;
    if (iso > today) return h('span', { class: 'cal-day v-future', 'aria-hidden': 'true' }, h('b', null, n));
    return h('a', { class: `cal-day ${cls}`, href: `#/food/${iso}`, 'aria-label': label, 'aria-current': iso === today ? 'date' : null },
      h('b', null, n), h('small', null, d.entries ? `${(d.kcal / 1000).toFixed(1)}k` : v === 'out' ? 'out' : v === 'fasted' ? '0' : ''));
  });
  const calendar = h('section', { class: 'card', 'aria-label': `Calendar, ${monthName(month)}` },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn bordered', 'aria-label': 'Previous month', disabled: month <= monthStart(firstData), onclick: () => { month = addMonths(month, -1); refresh(); } }, icon('left')),
      h('h2', null, monthName(month)),
      h('button', { class: 'icon-btn bordered', 'aria-label': 'Next month', disabled: month >= monthStart(today), onclick: () => { month = addMonths(month, 1); refresh(); } }, icon('right'))),
    h('div', { class: 'cal-grid' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => h('span', { class: 'cal-dow', 'aria-hidden': 'true' }, x)), cells),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'cal-key v-on' }), 'On target ±10%'),
      h('span', null, h('i', { class: 'cal-key v-over' }), 'Over'),
      h('span', null, h('i', { class: 'cal-key v-under' }), 'Under'),
      h('span', null, h('i', { class: 'cal-key v-none' }), 'Not logged')));

  // Recent days, newest first.
  const recentDays = days.filter(d => d.date < today && (d.entries > 0 || d.status !== 'auto')).slice(-6).reverse();
  const recent = h('section', { class: 'card', 'aria-label': 'Recent days', style: { gap: 0 } },
    h('h2', { style: { marginBottom: '4px' } }, 'Recent days'),
    recentDays.length ? h('div', { class: 'list' }, recentDays.map(d => {
      const t = targetsOn(d.date, ctx);
      const v = dayVerdict(d, t, today);
      const diff = Math.round(d.kcal - t.kcal);
      const word = v === 'over' ? `Over ${fmt0(diff)}` : v === 'under' ? `Under ${fmt0(-diff)}` : VERDICT[v][0];
      return h('a', { class: 'list-row linkish', href: `#/food/${d.date}` },
        h('div', { class: 'main' }, h('span', { class: 'title' }, relDay(d.date)),
          h('span', { class: 'small muted' }, d.entries ? `${fmt0(d.protein)} P · ${fmt0(d.carbs)} C · ${fmt0(d.fat)} F` : VERDICT[v][0])),
        h('span', { class: 'stat', style: { alignItems: 'flex-end' } },
          h('span', { class: 'num', style: { fontSize: '20px' } }, d.entries || v === 'fasted' ? fmt0(d.kcal) : '-'),
          h('span', { class: `tiny verdict ${VERDICT[v][1]}` }, word)));
    })) : h('p', { class: 'note' }, 'Days you log show up here.'));

  const topCard = top.foods.length ? h('section', { class: 'card', 'aria-label': 'Most logged, last 30 days', style: { gap: '8px' } },
    h('h2', null, 'Most logged'),
    h('span', { class: 'small muted', style: { marginTop: '-4px' } }, 'Last 30 days'),
    ...top.foods.slice(0, 5).map(f => h('div', { class: 'kv' }, h('span', null, f.name), h('span', { class: 'muted' }, `${f.count} time${f.count === 1 ? '' : 's'}`)))) : null;

  const logFood = () => openAddFood({ date: today, meal: guessMeal(settings), onDone: () => { state.stale = true; refresh(); } });
  root.replaceChildren(
    pageHead(`Last ${span} days`, 'Food', [h('button', { class: 'btn sm primary', onclick: logFood }, icon('plus', 18), 'Log food')]),
    h('div', { class: 'stack' },
      foodSwitch('overview'),
      h('div', { class: 'row' },
        h('div', { class: 'grow-3 stack' }, todayCard, calCard, macroCard),
        h('div', { class: 'grow-2 stack' }, calendar, recent, topCard))));
}

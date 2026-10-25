// Train overview: what's next, this week, 12-week trends, a month calendar, recent sessions and records.
import { h, icon, fmt0, fmt1, todayISO, shortDate, relDay, openSheet, recoveryColor, relDayLc } from '../ui.js';
import { get } from '../api.js';
import { state, loadSummary, wUnit, toDisplayW, liftDisplay } from '../store.js';
import { pageHead } from '../components.js';
import { chart, dateTicks } from '../charts.js';
import { addDays } from '../tdee.js';
import { mean, monthCells, monthName, addMonths, monthStart, weekStart } from '../stats.js';
import { trainSwitch, fmtDist, fmtDur, fmtPace, toDist, distUnit } from './cardio.js';

let measure = 'volume';
let month = null;

export async function render(root) {
  await loadSummary();
  const { summary, settings } = state;
  const today = todayISO();
  month ??= monthStart(today);
  const from = [addDays(today, -120), month].sort()[0];
  const [data, stats, rt] = await Promise.all([
    get('insights/data', { from, to: today }),
    get('training/stats', { from: addDays(today, -84) }),
    get('routines'),
  ]);
  const refresh = () => render(root);
  const byDay = data.days;
  const tday = summary.days[summary.days.length - 1];
  const recovery = tday.whoop?.recovery ?? null;

  // Next routine: the one you've gone longest without.
  const lastDone = {};
  for (const [d, x] of Object.entries(byDay)) for (const l of x.lifts || []) if (!lastDone[l.name] || lastDone[l.name] < d) lastDone[l.name] = d;
  const durations = {};
  for (const x of Object.values(byDay)) for (const l of x.lifts || []) if (l.duration_min) (durations[l.name] ??= []).push(l.duration_min);
  const routines = rt.routines.map(r => ({ ...r, last: lastDone[r.name] || null }))
    .sort((a, b) => (a.last || '') < (b.last || '') ? -1 : (a.last || '') > (b.last || '') ? 1 : a.name.localeCompare(b.name));
  const next = routines[0];
  const nextCard = next ? h('section', { class: 'card next-up', 'aria-label': 'Next up' },
    h('div', { class: 'card-head', style: { alignItems: 'flex-start' } },
      h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('span', { class: 'small on-deep-muted' }, routines.length > 1 ? 'Next in your rotation' : 'Your routine'),
        h('span', { class: 'num', style: { fontSize: '32px' } }, next.name),
        h('span', { class: 'small on-deep-muted' }, [`${next.exercise_ids.length} exercise${next.exercise_ids.length === 1 ? '' : 's'}`,
          next.last ? `last done ${relDayLc(next.last)}` : 'not done yet',
          durations[next.name] ? `about ${fmt0(mean(durations[next.name]))} min` : null].filter(Boolean).join(', '))),
      recovery != null ? h('a', { class: 'recovery-chip', href: '#/whoop', 'aria-label': `Recovery ${recovery} percent` },
        h('span', { class: 'num', style: { fontSize: '30px', color: recovery >= 67 ? 'var(--deep-green)' : recoveryColor(recovery) } }, `${recovery}%`),
        h('span', { class: 'tiny on-deep-muted' }, 'recovery')) : null),
    recovery != null && recovery < 34 ? h('p', { class: 'small on-deep-muted' }, 'Recovery is low today. A lighter session or a walk may suit you better.') : null,
    h('div', { class: 'next-actions' },
      h('a', { class: 'btn kcal', href: `#/train/new?routine=${next.id}` }, `Start ${next.name}`),
      h('button', { class: 'btn outline-light', onclick: () => pickRoutine(routines) }, 'Other routine')))
    : h('section', { class: 'card next-up' },
      h('h2', null, 'Start training'),
      h('p', { class: 'small on-deep-muted' }, 'Save the exercises you repeat as a routine and the next one shows up here.'),
      h('div', { class: 'next-actions' }, h('a', { class: 'btn kcal', href: '#/train/new' }, 'Empty workout'), h('a', { class: 'btn outline-light', href: '#/train/strength' }, 'Routines')));

  // This week, Monday to Sunday.
  const ws = weekStart(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const kindOf = (d) => { const x = byDay[d] || {}; return x.lifts?.length && x.cardio?.length ? 'both' : x.lifts?.length ? 'lift' : x.cardio?.length ? 'cardio' : 'rest'; };
  const weekLifts = week.reduce((a, d) => a + (byDay[d]?.lifts?.length || 0), 0);
  const weekCardio = week.flatMap(d => byDay[d]?.cardio || []);
  const wkStats = stats.weeks.find(w => w.week === ws) || { volume_kg: 0 };
  const prevStats = stats.weeks.find(w => w.week === addDays(ws, -7));
  const volChange = prevStats?.volume_kg ? (wkStats.volume_kg / prevStats.volume_kg - 1) * 100 : null;
  const goal = settings.lift_days_goal || 0;
  const dayIcon = { lift: 'train', cardio: 'run', both: 'train', rest: null };
  const weekCard = h('section', { class: 'card', 'aria-label': 'This week' },
    h('div', { class: 'card-head' }, h('h2', null, 'This week'), h('span', { class: 'small muted' }, `${shortDate(ws).split(', ').slice(1).join(', ')} to ${shortDate(addDays(ws, 6)).split(', ').slice(1).join(', ')}`)),
    h('div', { class: 'week-dots' }, week.map(d => {
      const k = kindOf(d);
      const future = d > today;
      const label = `${new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}: ${future ? 'coming up' : { lift: 'lifting', cardio: 'cardio', both: 'lifting and cardio', rest: d === today ? 'nothing yet' : 'rest' }[k]}`;
      return h('span', { class: 'wd' },
        h('span', { class: `wd-dot k-${future ? 'future' : k}${d === today ? ' is-today' : ''}`, role: 'img', 'aria-label': label }, dayIcon[k] && !future ? icon(dayIcon[k], 18) : null),
        h('span', { class: 'tiny muted', 'aria-hidden': 'true' }, new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })));
    })),
    h('div', { class: 'grid-3', style: { borderTop: '1px solid var(--rule)', paddingTop: '12px' } },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px' } }, goal ? `${weekLifts} of ${goal}` : String(weekLifts)), h('span', { class: 'label' }, goal ? 'Lifting goal' : 'Lifting sessions')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px' } }, fmt0(toDisplayW(wkStats.volume_kg))),
        h('span', { class: 'label' }, `${wUnit()} lifted${volChange != null && Math.abs(volChange) >= 1 ? `, ${volChange > 0 ? 'up' : 'down'} ${fmt0(Math.abs(volChange))}%` : ''}`)),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px' } }, weekCardio.some(c => c.distance_m) ? fmtDist(weekCardio.reduce((a, c) => a + (c.distance_m || 0), 0)) : String(weekCardio.length)),
        h('span', { class: 'label' }, weekCardio.some(c => c.distance_m) ? `cardio, ${weekCardio.length} session${weekCardio.length === 1 ? '' : 's'}` : 'cardio sessions'))));

  // 12-week trend.
  const weeks = stats.weeks.slice(-12);
  const strainByWeek = weeks.map(w => mean(summary.days.filter(d => d.date >= w.week && d.date < addDays(w.week, 7)).map(d => d.whoop?.strain ?? null)));
  const sessionsByWeek = weeks.map(w => Object.entries(byDay).filter(([d]) => d >= w.week && d < addDays(w.week, 7)).reduce((a, [, x]) => a + (x.lifts?.length || 0) + (x.cardio?.length || 0), 0));
  const series = {
    volume: { values: weeks.map(w => toDisplayW(w.volume_kg)), fmt: fmt0, label: `${wUnit()} lifted per week`, avg: (v) => `Average ${fmt0(mean(v))} ${wUnit()} a week` },
    sessions: { values: sessionsByWeek, fmt: fmt0, label: 'Sessions per week (lifting and cardio)', avg: (v) => `Average ${fmt1(mean(v))} sessions a week` },
    distance: { values: weeks.map(w => toDist(w.distance_m)), fmt: (v) => fmt1(v), label: `${distUnit()} per week`, avg: (v) => `Average ${fmt1(mean(v))} ${distUnit()} a week` },
    strain: { values: strainByWeek, fmt: fmt1, label: 'Average WHOOP day strain', avg: (v) => (mean(v) == null ? 'Connect WHOOP to see strain' : `Average day strain ${fmt1(mean(v))}`) },
  }[measure];
  const trendCard = h('section', { class: 'card', 'aria-label': 'Last 12 weeks' },
    h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, '12 weeks'),
      h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Measure' },
        [['volume', 'Volume'], ['sessions', 'Sessions'], ['distance', 'Distance'], ['strain', 'Strain']].map(([k, l]) =>
          h('button', { role: 'tab', 'aria-selected': String(measure === k), onclick: () => { measure = k; refresh(); } }, l)))),
    !series.values.some(v => v) ? h('p', { class: 'note' }, measure === 'strain' ? 'Connect WHOOP to see weekly strain.' : 'Log workouts and cardio and your weekly trend shows up here.') : chart({ n: weeks.length, w: 640, h: 170, yMin: 0, bars: [{ values: series.values, colorFn: (v, i) => (i === weeks.length - 1 ? 'var(--kcal)' : 'var(--lift)') }],
      xLabels: dateTicks(weeks.map(w => w.week), 3), yFormat: series.fmt, label: `${series.label} for 12 weeks: ${series.values.map(v => (v == null ? 'none' : series.fmt(v))).join(', ')}` }),
    h('span', { class: 'small muted' }, `${series.avg(series.values.slice(0, -1))}. This week so far in orange.`));

  // Month calendar with strength and cardio dots.
  const inMonth = Object.entries(byDay).filter(([d]) => d.startsWith(month.slice(0, 7)));
  const liftDays = inMonth.filter(([, x]) => x.lifts?.length).length, cardioDays = inMonth.filter(([, x]) => x.cardio?.length).length;
  const cells = monthCells(month).map(iso => {
    if (!iso) return h('span', { 'aria-hidden': 'true' });
    const n = Number(iso.slice(8));
    if (iso > today) return h('span', { class: 'cal-day v-future', 'aria-hidden': 'true' }, h('b', null, n));
    const x = byDay[iso] || {};
    const k = kindOf(iso);
    return h('button', { class: `cal-day t-${k}`, 'aria-current': iso === today ? 'date' : null,
      'aria-label': `${shortDate(iso)}, ${{ lift: 'lifting', cardio: 'cardio', both: 'lifting and cardio', rest: 'rest' }[k]}`, onclick: () => daySheet(iso, x) },
      h('b', null, n), h('span', { class: 'cal-dots', 'aria-hidden': 'true' }, x.lifts?.length ? h('i', { class: 'd-lift' }) : null, x.cardio?.length ? h('i', { class: 'd-cardio' }) : null));
  });
  const firstData = Object.keys(byDay)[0] || today;
  const calendar = h('section', { class: 'card', 'aria-label': `Calendar, ${monthName(month)}` },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn bordered', 'aria-label': 'Previous month', disabled: month <= monthStart(firstData), onclick: () => { month = addMonths(month, -1); refresh(); } }, icon('left')),
      h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, h('h2', null, monthName(month)),
        h('span', { class: 'tiny muted' }, `${liftDays} lifting, ${cardioDays} cardio day${cardioDays === 1 ? '' : 's'}`)),
      h('button', { class: 'icon-btn bordered', 'aria-label': 'Next month', disabled: month >= monthStart(today), onclick: () => { month = addMonths(month, 1); refresh(); } }, icon('right'))),
    h('div', { class: 'cal-grid' }, ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => h('span', { class: 'cal-dow', 'aria-hidden': 'true' }, x)), cells),
    h('div', { class: 'legend' },
      h('span', null, h('i', { class: 'd-lift', style: { width: '8px', height: '8px', borderRadius: '4px' } }), 'Strength'),
      h('span', null, h('i', { class: 'd-cardio', style: { width: '8px', height: '8px', borderRadius: '4px' } }), 'Cardio'),
      h('span', null, 'Tap a day to see it')));

  // Recent sessions.
  const recentList = Object.entries(byDay).reverse().flatMap(([d, x]) => [
    ...(x.lifts || []).map(l => ({ d, kind: 'lift', title: l.name, sub: l.duration_min ? `${l.duration_min} min` : 'Strength', href: `#/train/${l.id}` })),
    ...(x.cardio || []).map(c => ({ d, kind: 'cardio', title: c.distance_m ? `${c.activity}, ${fmtDist(c.distance_m)}` : c.activity,
      sub: [c.duration_s ? fmtDur(c.duration_s) : null, fmtPace(c.activity, c.distance_m, c.duration_s), c.strain != null ? `strain ${fmt1(c.strain)}` : null].filter(Boolean).join(', '),
      href: c.id ? `#/train/cardio/${c.id}` : `#/train/cardio/whoop/${encodeURIComponent(c.whoop_id)}` })),
  ]).slice(0, 6);
  const recent = h('section', { class: 'card', 'aria-label': 'Recent sessions', style: { gap: 0 } },
    h('h2', { style: { marginBottom: '4px' } }, 'Recent sessions'),
    recentList.length ? h('div', { class: 'list' }, recentList.map(s => h('a', { class: 'list-row linkish', href: s.href },
      h('span', { class: `act-ic sm k-${s.kind}`, 'aria-hidden': 'true' }, icon(s.kind === 'lift' ? 'train' : 'run')),
      h('div', { class: 'main' }, h('span', { class: 'title' }, s.title), h('span', { class: 'small muted' }, s.sub)),
      h('span', { class: 'small muted' }, relDay(s.d)))))
      : h('p', { class: 'note' }, 'Your workouts and cardio show up here.'));

  // Records set this calendar month.
  const mStart = monthStart(today);
  const recs = [
    ...stats.exercises.filter(e => e.best_e1rm_date >= mStart).map(e => ({ d: e.best_e1rm_date, n: `${e.name}, estimated 1-rep max`, v: `${liftDisplay(e.best_e1rm_kg)} ${wUnit()}` })),
    ...stats.exercises.filter(e => e.heaviest_date >= mStart && e.heaviest_date !== e.best_e1rm_date).map(e => ({ d: e.heaviest_date, n: `${e.name}, heaviest set`, v: `${liftDisplay(e.heaviest_kg)} × ${e.heaviest_reps}` })),
    ...stats.cardio_records.flatMap(r => [
      r.longest_distance?.date >= mStart ? { d: r.longest_distance.date, n: `${r.activity}, longest`, v: fmtDist(r.longest_distance.distance_m) } : null,
      r.best_pace?.date >= mStart ? { d: r.best_pace.date, n: `${r.activity}, best pace`, v: fmtPace(r.activity, r.best_pace.distance_m, r.best_pace.duration_s) } : null]).filter(Boolean),
  ].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 5);
  const records = recs.length ? h('section', { class: 'card', 'aria-label': 'New records this month', style: { gap: '8px' } },
    h('div', { class: 'card-head' }, h('h2', null, 'Records this month'), h('a', { class: 'small', href: '#/train/progress' }, 'All records')),
    ...recs.map(r => h('div', { class: 'kv' }, h('span', null, r.n), h('span', { style: { fontWeight: 600, whiteSpace: 'nowrap' } }, `${r.v}, ${shortDate(r.d).split(', ').slice(1).join(', ')}`)))) : null;

  root.replaceChildren(
    pageHead('Strength and cardio', 'Train', [h('a', { class: 'btn sm', href: '#/train/cardio/new' }, 'Log cardio'), h('a', { class: 'btn sm primary desk-only', href: '#/train/new' }, 'Empty workout')]),
    h('div', { class: 'stack' },
      trainSwitch('overview'),
      h('div', { class: 'row' },
        h('div', { class: 'grow-3 stack' }, nextCard, weekCard, trendCard),
        h('div', { class: 'grow-2 stack' }, calendar, recent, records))));
}

function pickRoutine(routines) {
  const s = openSheet({
    title: 'Start a routine',
    body: h('div', { class: 'list' },
      routines.map(r => h('a', { class: 'list-row linkish', href: `#/train/new?routine=${r.id}`, onclick: () => s.close() },
        h('div', { class: 'main' }, h('span', { class: 'title' }, r.name), h('span', { class: 'small muted' }, r.last ? `Last done ${relDayLc(r.last)}` : 'Not done yet')),
        icon('right', 18))),
      h('a', { class: 'btn block', href: '#/train/new', style: { marginTop: '12px' }, onclick: () => s.close() }, 'Empty workout')),
  });
}

function daySheet(iso, x) {
  const s = openSheet({
    title: shortDate(iso),
    body: h('div', { class: 'stack' },
      (x.lifts?.length || x.cardio?.length) ? h('div', { class: 'list' },
        ...(x.lifts || []).map(l => h('a', { class: 'list-row linkish', href: `#/train/${l.id}`, onclick: () => s.close() },
          h('div', { class: 'main' }, h('span', { class: 'title' }, l.name), h('span', { class: 'small muted' }, l.duration_min ? `Strength, ${l.duration_min} min` : 'Strength')), icon('right', 18))),
        ...(x.cardio || []).map(c => h('a', { class: 'list-row linkish', href: c.id ? `#/train/cardio/${c.id}` : `#/train/cardio/whoop/${encodeURIComponent(c.whoop_id)}`, onclick: () => s.close() },
          h('div', { class: 'main' }, h('span', { class: 'title' }, c.distance_m ? `${c.activity}, ${fmtDist(c.distance_m)}` : c.activity),
            h('span', { class: 'small muted' }, [c.duration_s ? fmtDur(c.duration_s) : null, c.strain != null ? `strain ${fmt1(c.strain)}` : null].filter(Boolean).join(', ') || 'Cardio')), icon('right', 18))))
        : h('p', { class: 'note' }, 'Rest day. Nothing logged.'),
      iso === todayISO() ? h('a', { class: 'btn primary block', href: '#/train/new', onclick: () => s.close() }, 'Start a workout') : null),
  });
}

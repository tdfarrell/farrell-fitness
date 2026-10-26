// Weekly report: Monday to Sunday at a glance. Also sent as a Sunday notification when reminders are on.
import { h, icon, fmt0, fmt1, todayISO, shortDate, hoursMin, toast } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, wUnit, toDisplayW, liftDisplay, markStale } from '../store.js';
import { pageHead, loading } from '../components.js';
import { chart } from '../charts.js';
import { fmtHold } from '../hold.js';
import { addDays } from '../tdee.js';
import { mean, weekStart, targetsOn } from '../stats.js';
import { fmtDist, fmtPace, distUnit, toDist } from './cardio.js';

const md = (iso) => shortDate(iso).split(', ').slice(1).join(', ');

export async function render(root, params) {
  root.replaceChildren(loading());
  await loadSummary();
  const { summary, model, targets, settings } = state;
  const today = todayISO();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? params[0] : today;
  const r = await get('report/week', { date: anchor });
  const from = r.from, to = r.to, through = r.through;
  const ctx = { checkins: summary.checkins, settings, current: targets };
  const days = summary.days.filter(d => d.date >= from && d.date <= to);
  const isCurrent = to >= today;
  const done = days.filter(d => d.date <= through && (d.date < today || !isCurrent));
  const logged = done.filter(d => (d.entries > 0 || d.status === 'fasted') && d.status !== 'exclude');
  const avgKcal = mean(logged.map(d => d.kcal));
  const avgTarget = mean(logged.map(d => targetsOn(d.date, ctx).kcal));
  const proteinHits = logged.filter(d => d.protein >= targetsOn(d.date, ctx).protein - 10).length;
  const trendAt = (d) => model.series.filter(s => s.date <= d && s.trend != null).pop()?.trend ?? null;
  const tStart = trendAt(addDays(from, -1)), tEnd = trendAt(through);
  const change = tStart != null && tEnd != null ? tEnd - tStart : null;
  const goalKg = (settings.goal.type === 'lose' ? -1 : settings.goal.type === 'gain' ? 1 : 0) * (settings.goal.rate_pct / 100) * (model.trendKg || 80);
  const whoopDays = done.map(d => d.whoop).filter(Boolean);
  const prevDays = summary.days.filter(d => d.date >= addDays(from, -7) && d.date < from);
  const recNow = mean(whoopDays.map(w => w.recovery)), recPrev = mean(prevDays.map(d => d.whoop?.recovery ?? null));
  const sleepNow = mean(whoopDays.map(w => w.sleep_hours)), needNow = mean(whoopDays.map(w => w.sleep_need_hours));
  const best = done.filter(d => d.whoop?.recovery != null).sort((a, b) => b.whoop.recovery - a.whoop.recovery)[0];
  const t = r.training, p = r.previous;

  // One-line summary.
  const bits = [];
  if (change != null) {
    const pace = goalKg ? change / goalKg : null;
    const word = settings.goal.type === 'maintain' ? (Math.abs(toDisplayW(change)) < 0.6 ? 'Holding steady.' : `Trend weight ${change < 0 ? 'down' : 'up'} ${fmt1(Math.abs(toDisplayW(change)))} ${wUnit()}.`)
      : pace != null && pace >= 0.7 && pace <= 1.4 ? 'On pace.' : pace != null && pace > 1.4 ? 'Ahead of pace.' : 'Behind pace.';
    bits.push(word);
    if (settings.goal.type !== 'maintain') bits.push(`Trend weight ${change < 0 ? 'down' : 'up'} ${fmt1(Math.abs(toDisplayW(change)))} ${wUnit()}`);
  }
  if (done.length) bits.push(logged.length === done.length ? 'every day logged' : `${logged.length} of ${done.length} days logged`);
  if (r.records.length) bits.push(r.records.length === 1 ? `a new ${r.records[0].kind === 'e1rm' ? r.records[0].name.toLowerCase() : r.records[0].name.toLowerCase() + ' ' + r.records[0].kind} record` : `${r.records.length} new records`);
  const nothing = !logged.length && !t.lifts && !t.cardio && change == null;
  const sentence = nothing ? (isCurrent ? 'Nothing logged this week yet.' : 'Nothing was logged this week.') : bits.length ? bits[0] + (bits.length > 1 ? ' ' + bits.slice(1).join(', ').replace(/^./, c => c.toUpperCase()) + '.' : '') : 'Nothing logged this week yet.';

  const prevLink = h('a', { class: 'icon-btn bordered', href: `#/report/${addDays(from, -1)}`, 'aria-label': 'Previous week' }, icon('left'));
  const nextLink = isCurrent ? h('span', { class: 'icon-btn bordered', 'aria-disabled': 'true', style: { opacity: 0.4 } }, icon('right'))
    : h('a', { class: 'icon-btn bordered', href: addDays(to, 1) >= weekStart(today) ? '#/report' : `#/report/${addDays(to, 1)}`, 'aria-label': 'Next week' }, icon('right'));

  const headline = h('section', { class: 'card', 'aria-label': 'Headline' },
    h('p', { class: 'week-sentence' }, sentence),
    h('div', { class: 'grid-3', style: { borderTop: '1px solid var(--rule)', paddingTop: '12px' } },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '28px' } }, change == null ? '-' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${fmt1(Math.abs(toDisplayW(change)))}`, h('span', { class: 'unit' }, ` ${wUnit()}`)),
        h('span', { class: 'label' }, goalKg ? `Trend, goal ${goalKg > 0 ? '+' : '−'}${fmt1(Math.abs(toDisplayW(goalKg)))}` : 'Trend change')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '28px', color: 'var(--kcal)' } }, avgKcal == null ? '-' : fmt0(avgKcal)), h('span', { class: 'label' }, avgTarget ? `Avg kcal, target ${fmt0(avgTarget)}` : 'Avg kcal')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '28px' } }, `${logged.length}/${done.length || 7}`), h('span', { class: 'label' }, 'Days logged'))));

  const kcalCard = h('section', { class: 'card', 'aria-label': 'Calories by day' },
    h('div', { class: 'card-head' }, h('h2', null, 'Calories by day'), h('span', { class: 'small muted' }, 'dashed line is the target')),
    chart({ n: 7, w: 560, h: 170, yMin: 0, bars: [{ values: days.map(d => (d.date > through || d.status === 'exclude' || (!d.entries && d.status !== 'fasted') ? null : d.kcal)), color: 'var(--kcal)', emptyColor: 'var(--rule)' }],
      lines: [{ values: days.map(d => targetsOn(d.date, ctx).kcal), color: 'var(--ink)', width: 2, dash: '6 4' }],
      xLabels: days.map((d, i) => ({ i, text: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) })), yFormat: fmt0,
      label: `Calories each day: ${days.map(d => (d.entries ? fmt0(d.kcal) : 'none')).join(', ')}` }),
    logged.length ? h('span', { class: 'small muted' }, `Protein within 10 g of target on ${proteinHits} of ${logged.length} days, averaging ${fmt0(mean(logged.map(d => d.protein)))} g.`) : null);

  const delta = (now, prev, fmt, unit = '') => (prev == null || now == null ? null : Math.abs(now - prev) < 1e-9 ? 'same as last week' : `${now > prev ? 'up' : 'down'} ${fmt(Math.abs(now - prev))}${unit}`);
  const pct = (now, prev) => (prev ? `${now >= prev ? 'up' : 'down'} ${fmt0(Math.abs(now / prev - 1) * 100)}%` : null);
  const tile = (v, label, sub, good) => h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '26px' } }, v), h('span', { class: 'label', style: { fontSize: '13px' } }, label),
    sub ? h('span', { class: 'tiny', style: { fontWeight: 600, color: good == null ? 'var(--muted)' : good ? 'var(--green)' : 'var(--muted)' } }, sub) : null);
  const habitsNow = r.habits ? r.habits.done / r.habits.total * 100 : null, habitsPrev = r.habits_previous ? r.habits_previous.done / r.habits_previous.total * 100 : null;
  const tiles = h('section', { class: 'card', 'aria-label': 'Training and recovery' },
    h('div', { class: 'grid-2 tiles' },
      tile(String(t.lifts), t.lifts === 1 ? 'Lifting session' : 'Lifting sessions', delta(t.lifts, p.lifts, fmt0), t.lifts >= p.lifts),
      tile(`${fmt0(toDisplayW(t.volume_kg))}`, `${wUnit()} lifted`, pct(t.volume_kg, p.volume_kg), t.volume_kg >= p.volume_kg),
      tile(t.distance_m ? fmtDist(t.distance_m) : String(t.cardio), t.distance_m ? `Cardio, ${t.cardio} session${t.cardio === 1 ? '' : 's'}` : 'Cardio sessions', t.distance_m || p.distance_m ? delta(toDist(t.distance_m), toDist(p.distance_m), fmt1, ` ${distUnit()}`) : null, t.distance_m >= p.distance_m),
      tile(recNow == null ? '-' : `${fmt0(recNow)}%`, 'Avg recovery', delta(recNow, recPrev, fmt0), recNow >= recPrev),
      tile(sleepNow == null ? '-' : hoursMin(sleepNow), 'Avg sleep', needNow ? `${fmt0(sleepNow / needNow * 100)}% of need` : null, null),
      tile(habitsNow == null ? '-' : `${fmt0(habitsNow)}%`, 'Habits done', habitsPrev != null && habitsNow != null ? delta(habitsNow, habitsPrev, fmt0, ' pts') : null, habitsNow >= habitsPrev)));

  const wins = [
    ...r.records.slice(0, 4).map(x => x.kind === 'e1rm' ? ['trophy', `${x.name}: estimated 1-rep max ${liftDisplay(x.e1rm_kg)} ${wUnit()}, a new best (${liftDisplay(x.weight_kg)} × ${x.reps})`]
      : x.kind === 'hold' ? ['trophy', `${x.name}: longest hold yet, ${fmtHold(x.duration_s)}${x.weight_kg ? ` at +${liftDisplay(x.weight_kg)} ${wUnit()}` : ''}`]
      : x.kind === 'pace' ? ['trophy', `${x.name}: best pace yet, ${fmtPace(x.name, x.distance_m, x.sec_per_km * x.distance_m / 1000)}`]
      : ['trophy', `${x.name}: longest yet, ${fmtDist(x.distance_m)}`]),
    best ? ['pulse', `Best recovery ${new Date(best.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}, ${best.whoop.recovery}%${best.whoop.sleep_hours ? ` after ${hoursMin(best.whoop.sleep_hours)} of sleep` : ''}`] : null,
    done.filter(d => d.weight_kg).length === done.length && done.length >= 5 ? ['weight', `Weighed in every day`] : null,
  ].filter(Boolean);
  const winsCard = wins.length ? h('section', { class: 'card', 'aria-label': 'Highlights', style: { gap: 0 } },
    h('h2', { style: { marginBottom: '4px' } }, 'Highlights'),
    h('div', { class: 'list' }, wins.map(([ic, text]) => h('div', { class: 'list-row', style: { justifyContent: 'flex-start' } }, h('span', { class: 'win-ic', 'aria-hidden': 'true' }, icon(ic, 18)), h('span', null, text))))) : null;

  const rem = settings.reminders?.report || { on: true };
  const notify = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: rem.on, onchange: async (e) => {
    try { await post('settings', { reminders: { report: { on: e.target.checked } } }); markStale(); toast(e.target.checked ? 'You’ll get this as a notification each Sunday' : 'Weekly report notification off'); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
  } }), h('span', null, 'Notify me when the week’s report is ready (Sunday evening). ', h('a', { href: '#/settings/sync' }, 'Reminder settings')));

  root.replaceChildren(
    pageHead(`${md(from)} to ${md(to)}`, isCurrent ? 'This week' : 'Your week', [prevLink, nextLink]),
    h('div', { class: 'stack', style: { maxWidth: '820px' } },
      headline,
      h('div', { class: 'row' }, h('div', { class: 'grow-3 stack' }, kcalCard, tiles), h('div', { class: 'grow-2 stack' }, winsCard,
        h('a', { class: 'linkcard', href: '#/insights' }, h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('span', { style: { fontWeight: 600 } }, 'Insights'), h('span', { class: 'small muted' }, 'Patterns across your weeks')), icon('right', 20)))),
      notify));
}

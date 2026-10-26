import { h, icon, fmt0, fmt1, signed, longDate, todayISO, recoveryColor, relDay, toast } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, fmtW, wUnit, toDisplayW } from '../store.js';
import { pageHead, calorieCard, whoopCard } from '../components.js';
import { chart, sparkline, dateTicks } from '../charts.js';
import { openWeightSheet } from './weight.js';
import { openAddFood } from './food.js';
import { habitRow } from './habits.js';
import { drinksCard } from './drinks.js';
import { startHref, occTitle, clock } from './schedule.js';

export async function render(root) {
  await loadSummary();
  const today = todayISO();
  const { summary, model, targets, checkin, settings } = state;
  const days = summary.days;
  const tday = days[days.length - 1];
  const totals = { kcal: tday.kcal, protein: tday.protein, carbs: tday.carbs, fat: tday.fat, fiber: tday.fiber || 0 };
  const w = tday.whoop || days[days.length - 2]?.whoop || null;
  const recent7 = days.slice(-7).map(d => d.whoop?.recovery).filter(v => v != null);
  const avgRec = recent7.length ? recent7.reduce((a, b) => a + b, 0) / recent7.length : null;

  const [workoutsRes, hb, meds, jr, drinks, plan] = await Promise.all([
    get('workouts', { from: days[Math.max(0, days.length - 14)].date, to: today }).catch(() => ({ workouts: [], whoop: [] })),
    get('habits', { date: today, days: 7 }).catch(() => null),
    get('health/items', { date: today }).catch(() => null),
    get('journal', { date: today }).catch(() => null),
    settings.drinks?.show?.length ? get('drinks', { date: today }).catch(() => null) : null,
    settings.schedule?.show_today !== false ? get('schedule', { from: today, to: today }).catch(() => null) : null,
  ]);
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

  // Shown until the expenditure estimate has enough of your own data (7 finished logged days and a
  // weigh-in), unless you hide it.
  const firstRun = !model.hasData && !settings.intro_dismissed;
  const weighed = model.trendKg != null;
  const daysDone = Math.min(model.loggedDays, 7);
  const step = (done, text) => h('li', { class: 'intro-step' + (done ? ' done' : '') },
    h('span', { class: 'intro-tick', 'aria-hidden': 'true' }, done ? icon('check', 14) : null), h('span', null, text, done ? h('span', { class: 'sr' }, ' (done)') : null));
  const intro = firstRun ? h('section', { class: 'card', 'aria-label': 'Getting started' },
    h('div', { class: 'card-head', style: { alignItems: 'center' } },
      h('h2', null, 'Getting started'),
      h('button', { class: 'icon-btn', 'aria-label': 'Hide getting started', onclick: async (e) => {
        e.currentTarget.closest('section').remove();
        try { await post('settings', { intro_dismissed: true }); state.settings.intro_dismissed = true; } catch (err) { toast(err.message, 'error'); }
      } }, icon('close'))),
    h('p', { class: 'note' }, 'Your expenditure estimate switches from a formula to your own data once you have:'),
    h('ul', { class: 'intro-steps' },
      step(weighed, weighed ? 'At least one weigh-in' : 'Log your weight (each morning is best)'),
      step(daysDone >= 7, `7 finished days of food logged: ${daysDone} of 7 so far`)),
    h('p', { class: 'note small' }, "Today counts once it's over. Days you didn't log fully can be marked Leave out in the food log so they don't skew the estimate."),
    h('div', { class: 'row' },
      weighed ? null : h('button', { class: 'btn sm', onclick: () => openWeightSheet({ onDone: () => rerender(root) }) }, 'Log weight'),
      h('a', { class: 'btn sm', href: '#/settings' }, 'Set your goal'))) : null;

  // Phone: two small cards with sparklines.
  const smallCards = h('div', { class: 'grid-2 phone-only' },
    h('a', { class: 'card', href: '#/progress', style: { textDecoration: 'none', color: 'inherit', gap: '4px' }, 'aria-label': 'Expenditure' },
      h('span', { class: 'small muted', style: { fontWeight: 500 } }, 'Expenditure'),
      h('span', { class: 'num', style: { fontSize: '34px' } }, fmt0(model.expenditure)),
      h('span', { class: 'small muted' }, weekChangeText(model)),
      sparkline(s28.map(s => s.expenditure), 'var(--kcal)', 'Expenditure over the last 4 weeks')),
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
      lines: [{ values: s56.map(s => toDisplayW(s.trend)), color: 'var(--primary)', endDot: true }],
      xLabels: dateTicks(wDates), yFormat: (v) => fmt0(v), label: 'Scale weights and smoothed trend over 8 weeks' }));

  const s84 = model.series.slice(-84);
  const whoopKcal = days.slice(-84).map(d => d.whoop?.kcal ?? null);
  const hasWhoopKcal = whoopKcal.some(v => v != null);
  const last14Whoop = days.slice(-15, -1).map(d => d.whoop?.kcal).filter(v => v != null);
  const expChart = h('section', { class: 'card grow-2 desk-only', style: { flexDirection: 'column' }, 'aria-label': 'Expenditure' },
    h('h2', null, 'Expenditure'),
    h('div', { style: { display: 'flex', gap: '28px' } },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '34px', color: 'var(--kcal)' } }, fmt0(model.expenditure)), h('span', { class: 'label', style: { fontSize: '13px' } }, 'adaptive estimate')),
      last14Whoop.length ? h('div', { class: 'stat' }, h('span', { class: 'num muted', style: { fontSize: '34px' } }, fmt0(avg(last14Whoop))), h('span', { class: 'label', style: { fontSize: '13px' } }, 'WHOOP, 14-day avg')) : null),
    chart({ n: s84.length, w: 400, h: 180, lines: [
      ...(hasWhoopKcal ? [{ values: smooth(whoopKcal, 7), color: 'var(--dot)', width: 2, dash: '5 4' }] : []),
      { values: s84.map(s => s.expenditure), color: 'var(--kcal)' }],
      xLabels: dateTicks(s84.map(s => s.date), 3), yFormat: fmt0, label: 'Adaptive expenditure estimate over 12 weeks' + (hasWhoopKcal ? ', with WHOOP calories for comparison' : '') }),
    h('p', { class: 'note small' }, 'Targets use the adaptive estimate, which comes from your intake and weight trend.' + (hasWhoopKcal ? " WHOOP's number is shown for comparison." : '')));

  const d14 = days.slice(-14);
  const logged14 = d14.slice(0, -1).filter(d => d.entries > 0);
  const intakeChart = h('section', { class: 'card grow-3 desk-only', style: { flexDirection: 'column' }, 'aria-label': 'Intake, last 14 days' },
    h('div', { class: 'card-head' }, h('h2', null, 'Intake, last 14 days'),
      h('span', { class: 'muted', style: { fontSize: '14px' } }, logged14.length ? `Avg ${fmt0(avg(logged14.map(d => d.kcal)))} kcal, ${logged14.length} of ${d14.length - 1} days logged` : 'No days logged yet')),
    chart({ n: d14.length, w: 640, h: 170, yMin: 0,
      bars: [{ values: d14.map(d => (d.entries > 0 ? d.kcal : null)), colorFn: (v, i) => (i === d14.length - 1 ? 'var(--soft-kcal)' : 'var(--kcal)'), emptyColor: 'var(--ground)' }],
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

  // Habits: progress plus the next few that aren't done.
  const buildHabits = () => hb && hb.habits.length ? (() => {
    const list = hb.habits;
    const done = list.filter(x => x.done).length;
    const todo = list.filter(x => !x.done).slice(0, 4);
    return h('section', { class: 'card grow-2', 'aria-label': 'Habits' },
      h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, 'Habits'), h('a', { href: '#/habits', style: { fontWeight: 600, fontSize: '14px' } }, `${done} of ${list.length} done`)),
      h('div', { class: 'habit-segs', role: 'img', 'aria-label': `${done} of ${list.length} habits done` }, list.map((x, i) => h('div', { class: i < done ? 'on' : '' }))),
      todo.length ? h('div', { class: 'list' }, todo.map(x => habitRow(x, today, () => rerender(root))))
        : h('p', { class: 'note' }, 'Everything is done for today.'));
  })() : null;
  const habitsCard = buildHabits();

  // Meds and supplements: one pill per dose due today, tap to mark taken.
  const PART = { morning: 'morning', midday: 'midday', evening: 'evening', bedtime: 'bedtime', any: '' };
  const medsCard = meds && meds.items.some(i => i.doses.length) ? (() => {
    const box = h('div', { class: 'pills' });
    const draw = (items) => box.replaceChildren(...items.flatMap(i => i.doses.map(d => h('button', { class: 'pill med-pill', 'aria-pressed': String(!!d.taken_at),
      'aria-label': `${i.name}${i.doses.length > 1 ? `, ${PART[d.part] || `dose ${d.slot + 1}`}` : ''}, ${d.taken_at ? 'taken' : 'not taken'}`, onclick: async () => {
        try { const r = await post('health/dose', { item_id: i.id, date: today, slot: d.slot, taken: !d.taken_at }); draw(r.items); }
        catch (e) { toast(e.message, 'error'); }
      } }, d.taken_at ? icon('check', 16) : null, i.name, i.doses.length > 1 ? h('span', { class: 'muted', style: { fontWeight: 500 } }, ` ${PART[d.part] || d.slot + 1}`) : null))));
    draw(meds.items);
    return h('section', { class: 'card grow-2', 'aria-label': 'Medications and supplements' },
      h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, 'Meds and supplements'), h('a', { href: '#/health/meds', style: { fontWeight: 600, fontSize: '14px' } }, 'All')),
      box);
  })() : null;

  // Water, caffeine and alcohol. A water habit, if there is one, updates when water changes.
  const drinksEl = drinks ? drinksCard(today, drinks, {
    inRow: true,
    onRefresh: () => rerender(root),
    onChange: () => {
      if (!hb?.habits.some(x => x.kind === 'water')) return;
      get('habits', { date: today, days: 7 }).then(r => {
        hb.habits = r.habits;
        const old = root.querySelector('section[aria-label="Habits"]');
        const fresh = buildHabits();
        if (old && fresh) old.replaceWith(fresh);
      }).catch(() => {});
    },
  }) : null;

  const tw = tday.whoop;
  const stepGoal = hb?.habits.find(x => x.kind === 'steps')?.target || 10000;
  const stepsCard = tw?.step_count != null ? h('a', { class: 'card', href: '#/health', style: { textDecoration: 'none', color: 'inherit', gap: '4px' }, 'aria-label': 'Steps' },
    h('span', { class: 'small muted', style: { fontWeight: 500 } }, 'Steps, WHOOP'),
    h('span', { class: 'num', style: { fontSize: '34px' } }, fmt0(tw.step_count)),
    h('span', { class: 'small muted' }, `of ${fmt0(stepGoal)} goal`),
    h('div', { class: 'meter', style: { marginTop: '6px' } }, h('div', { style: { width: `${Math.min(100, tw.step_count / stepGoal * 100)}%`, background: 'var(--primary)' } }))) : null;
  const journalCard = h('a', { class: 'linkcard', href: '#/journal', style: { flex: '1 1 260px' } },
    h('span', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      h('span', { class: 'journal-ic', 'aria-hidden': 'true' }, icon('journal')),
      h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h('span', { style: { fontWeight: 600 } }, 'Journal'),
        h('span', { class: 'small muted' }, jr?.entry ? 'Today’s entry is saved. Add to it?' : 'How did today go?'))),
    icon('right', 20));

  // Today's scheduled training, with Start (or a tick once it's done).
  const planned = plan?.occurrences || [];
  const planCard = planned.length ? h('section', { class: 'card', 'aria-label': "Today's training", style: { gap: 0 } },
    h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, "Today's training"), h('a', { class: 'small', href: '#/train' }, 'Train')),
    h('div', { class: 'list' }, planned.map(o => h('div', { class: 'list-row' },
      h('span', { class: `act-ic sm k-${o.kind === 'strength' ? 'lift' : o.kind === 'cardio' ? 'cardio' : 'stretch'}`, 'aria-hidden': 'true' }, icon(o.kind === 'strength' ? 'train' : o.kind === 'cardio' ? 'run' : 'stretch')),
      h('div', { class: 'main' }, h('span', { class: 'title' }, occTitle(o)), h('span', { class: 'small muted' }, [o.time ? clock(o.time) : null, o.done ? 'Done' : null].filter(Boolean).join(', ') || 'Today')),
      o.done ? h('span', { class: 'done-tick', 'aria-label': 'Done' }, icon('check', 18)) : h('a', { class: 'btn sm', href: startHref(o) }, 'Start'))))) : null;

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
      planCard,
      habitsCard || medsCard ? h('div', { class: 'row' }, habitsCard, medsCard) : null,
      drinksEl ? h('div', { class: 'row' }, drinksEl) : null,
      smallCards,
      h('div', { class: 'row' }, stepsCard ? h('div', { style: { flex: '1 1 260px', display: 'flex', flexDirection: 'column' } }, stepsCard) : null, journalCard),
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

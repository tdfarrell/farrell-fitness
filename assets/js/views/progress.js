import { h, fmt0, fmt1, signed, longDate, shortDate, todayISO, toast } from '../ui.js';
import { post } from '../api.js';
import { state, loadSummary, markStale, fmtW, wUnit, toDisplayW } from '../store.js';
import { pageHead } from '../components.js';
import { chart } from '../charts.js';
import { targetsFor, weekReview } from '../tdee.js';

let forceCheckin = false;

export async function render(root) {
  await loadSummary();
  const { model, settings, summary, targets, checkin } = state;
  const today = todayISO();
  const review = weekReview(model, today);
  const coached = settings.program !== 'manual';
  const showCheckin = coached && (checkin.due || forceCheckin);
  const proposed = targetsFor(model.expenditure, model.trendKg || 80, settings);
  const prev = summary.checkins[0];

  // 12 weekly buckets ending yesterday.
  const done = model.series.filter(s => s.date < today);
  const weeks = [];
  for (let k = 11; k >= 0; k--) {
    const slice = done.slice(Math.max(0, done.length - (k + 1) * 7), done.length - k * 7);
    if (!slice.length) continue;
    const logged = slice.filter(s => s.intake != null);
    weeks.push({
      end: slice[slice.length - 1].date,
      intake: logged.length ? logged.reduce((a, s) => a + s.intake, 0) / logged.length : null,
      exp: slice[slice.length - 1].expenditure,
    });
  }
  const goal = settings.goal || {};
  const goalText = goal.type === 'maintain' ? 'Maintain weight'
    : `${goal.type === 'lose' ? 'Lose' : 'Gain'} ${fmt1(Math.abs(toDisplayW(proposed.rateKgWeek)))} ${wUnit()}/wk`;

  const weekCard = h('section', { class: 'card', 'aria-label': 'This week', style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' } },
    stat('Expenditure', fmt0(model.expenditure), review.expenditureChange == null ? 'starting estimate' : `${signed(review.expenditureChange, fmt0)} vs last wk`),
    stat('Avg intake', review.avgIntake == null ? '-' : fmt0(review.avgIntake), `${review.daysLogged} of 7 days logged`),
    stat('Trend change', review.trendChangeKg == null ? '-' : `${signed(toDisplayW(review.trendChangeKg))} ${wUnit()}`, goal.type === 'maintain' ? 'goal: hold steady' : `goal ${signed(toDisplayW(proposed.rateKgWeek))} ${wUnit()}/wk`));

  const chartCard = h('section', { class: 'card grow-3', 'aria-label': 'Expenditure and intake' },
    h('h2', null, `${weeks.length} weeks`),
    weeks.some(w => w.intake != null)
      ? chart({ n: weeks.length, w: 640, h: 220, yMin: Math.max(0, Math.min(...weeks.map(w => Math.min(w.intake ?? Infinity, w.exp ?? Infinity))) - 400),
          bars: [{ values: weeks.map(w => w.intake), color: 'var(--soft-kcal)' }],
          lines: [{ values: weeks.map(w => w.exp), color: 'var(--kcal)' }],
          xLabels: [{ i: 0, text: shortDate(weeks[0].end).split(', ')[1] }, { i: weeks.length - 1, text: shortDate(weeks[weeks.length - 1].end).split(', ')[1] }],
          yFormat: fmt0, label: 'Weekly average intake as bars with the expenditure estimate as a line' })
      : h('p', { class: 'note' }, 'Log food for a week to see intake against expenditure.'),
    h('div', { class: 'legend' },
      h('span', null, h('i', { style: { width: '16px', height: '3px', borderRadius: '2px', background: 'var(--kcal)' } }), 'Expenditure'),
      h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '2px', background: 'var(--soft-kcal)' } }), 'Avg intake')));

  const macroRow = (name, cls, v, was) => h('div', { style: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', padding: '10px 0', borderTop: '1px solid var(--rule)', alignItems: 'center' } },
    h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 } }, h('span', { class: 'swatch ' + cls, style: { height: '16px' }, 'aria-hidden': 'true' }), name),
    h('span', { class: 'num', style: { fontSize: '22px', textAlign: 'right' } }, `${fmt0(v)} g`),
    h('span', { class: 'small muted', style: { textAlign: 'right' } }, was == null ? '' : v === was ? 'no change' : `${signed(v - was, fmt0)} g`));

  let targetCard;
  if (showCheckin) {
    const diff = prev ? proposed.kcal - prev.kcal : null;
    const why = !model.hasData
      ? 'Not enough logged days yet, so this uses your starting estimate. It gets sharper every week you log.'
      : prev
        ? `Your expenditure ${review.expenditureChange > 5 ? 'rose' : review.expenditureChange < -5 ? 'fell' : 'held steady'}, so calories ${diff > 0 ? `go up ${fmt0(diff)}` : diff < 0 ? `go down ${fmt0(-diff)}` : 'stay the same'} to keep you on pace for your goal.`
        : 'These targets come from your measured expenditure and your goal.';
    const apply = async (kept) => {
      const t = kept && prev ? prev : proposed;
      await post('checkins/save', {
        date: today, expenditure: Math.round(model.expenditure), trend_kg: model.trendKg,
        kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat,
        detail: { kept: !!kept, review, goal: settings.goal, proposed },
      });
      markStale(); forceCheckin = false;
      toast(kept ? 'Kept your current targets' : 'New targets applied');
      render(root);
    };
    targetCard = h('section', { class: 'card grow-2', 'aria-label': 'New targets' },
      h('div', { class: 'card-head' }, h('h2', null, 'New daily targets'), h('span', { class: 'small muted' }, goalText)),
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
        h('span', { class: 'hero-num', style: { fontSize: '60px' } }, fmt0(proposed.kcal)),
        h('span', { class: 'muted' }, prev ? `kcal, was ${fmt0(prev.kcal)}` : 'kcal')),
      h('div', null,
        macroRow('Protein', 'c-protein', proposed.protein, prev?.protein),
        macroRow('Carbs', 'c-carbs', proposed.carbs, prev?.carbs),
        macroRow('Fat', 'c-fat', proposed.fat, prev?.fat)),
      h('p', { class: 'note' }, why),
      h('button', { class: 'btn primary block', onclick: () => apply(false) }, 'Apply new targets'),
      prev ? h('button', { class: 'btn block', onclick: () => apply(true) }, 'Keep current targets') : null);
  } else {
    targetCard = h('section', { class: 'card grow-2', 'aria-label': 'Current targets' },
      h('div', { class: 'card-head' }, h('h2', null, 'Daily targets'),
        h('span', { class: 'small muted' }, coached ? (targets.date ? `set ${shortDate(targets.date)}` : 'starting estimate') : 'set by you')),
      h('span', { class: 'hero-num', style: { fontSize: '60px' } }, fmt0(targets.kcal)),
      h('div', null,
        macroRow('Protein', 'c-protein', targets.protein),
        macroRow('Carbs', 'c-carbs', targets.carbs),
        macroRow('Fat', 'c-fat', targets.fat)),
      coached
        ? h('p', { class: 'note' }, `Next check-in ${checkin.daysUntil <= 0 ? 'is due' : checkin.daysUntil === 1 ? 'is tomorrow' : `is ${longDate(checkin.next).split(',')[0]}, ${shortDate(checkin.next).split(', ')[1]}`}. ${goalText}.`)
        : h('p', { class: 'note' }, 'You set these in Settings. Switch to coached targets to have weekly check-ins adjust them.'),
      coached
        ? h('button', { class: 'btn block', onclick: () => { forceCheckin = true; render(root); } }, 'Check in now')
        : h('a', { class: 'btn block', href: '#/settings' }, 'Edit targets'));
  }

  const hist = summary.checkins.slice(0, 26);
  const histCard = h('section', { class: 'card', 'aria-label': 'Check-in history' },
    h('h2', null, 'Check-in history'),
    hist.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ...['Date', 'Expenditure', 'Trend', 'Calories', 'Protein', 'Carbs', 'Fat'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
      h('tbody', null, hist.map(c => h('tr', null,
        h('td', { style: { whiteSpace: 'nowrap' } }, shortDate(c.date).split(', ')[1]), h('td', { class: 'r' }, fmt0(c.expenditure)), h('td', { class: 'r' }, c.trend_kg ? `${fmtW(c.trend_kg)}` : '-'),
        h('td', { class: 'r', style: { fontWeight: 600 } }, fmt0(c.kcal)), h('td', { class: 'r' }, fmt0(c.protein)), h('td', { class: 'r' }, fmt0(c.carbs)), h('td', { class: 'r' }, fmt0(c.fat)))))))
      : h('p', { class: 'note' }, 'Your weekly check-ins will be listed here.'));

  root.replaceChildren(
    pageHead(longDate(today), showCheckin ? 'Weekly check-in' : 'Progress'),
    h('div', { class: 'stack' }, weekCard, h('div', { class: 'row' }, chartCard, targetCard), histCard,
      h('p', { class: 'note small' }, 'How it works: each day, your average logged intake over the last two weeks is compared with how fast your trend weight is changing. Since each kilogram of body weight holds about 7,700 kcal, the difference tells us what you burn. The estimate moves gradually, so one odd week does not swing your targets.')));
}

function stat(label, value, sub) {
  return h('div', { class: 'stat' }, h('span', { class: 'label' }, label), h('span', { class: 'num', style: { fontSize: '28px' } }, value), h('span', { class: 'label' }, sub));
}

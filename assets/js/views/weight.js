import { h, fmt1, todayISO, relDay, openSheet, toast, confirmSheet, signed } from '../ui.js';
import { post } from '../api.js';
import { state, loadSummary, markStale, fmtW, wUnit, toDisplayW, fromDisplayW } from '../store.js';
import { pageHead } from '../components.js';
import { chart, dateTicks } from '../charts.js';

const RANGES = [['1M', 30], ['2M', 56], ['6M', 182], ['1Y', 365], ['All', 99999]];
let range = 56;

export function openWeightSheet({ date = todayISO(), current = null, onDone } = {}) {
  const input = h('input', { class: 'input big', inputmode: 'decimal', id: 'w-in', value: current != null ? fmtW(current) : '', autofocus: true, 'aria-label': `Weight in ${wUnit()}` });
  const dateIn = h('input', { class: 'input', type: 'date', value: date, max: todayISO(), id: 'w-date' });
  const s = openSheet({
    title: 'Log weight',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const kg = fromDisplayW(input.value.replace(',', '.'));
      if (!kg || Number.isNaN(kg)) { toast('Enter a weight', 'error'); return; }
      try {
        const r = await post('weights/save', { date: dateIn.value, weight_kg: kg });
        markStale();
        toast(r.queued ? 'Saved offline. It will sync when you reconnect.' : 'Weight saved');
        s.close();
        onDone?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('div', { class: 'form-grid' },
        h('label', { class: 'field', for: 'w-in' }, `Weight (${wUnit()})`, input),
        h('label', { class: 'field', for: 'w-date' }, 'Date', dateIn)),
      h('p', { class: 'note small' }, 'Weigh in the morning after the bathroom, before eating, for the steadiest trend.'),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save weight')),
  });
}

export async function render(root) {
  await loadSummary();
  const { model, settings, summary } = state;
  const series = model.series;
  const n = Math.min(range, series.length);
  const view = series.slice(-n);
  const firstIdx = view.findIndex(s => s.trend != null);
  const shown = firstIdx > 0 ? view.slice(firstIdx) : view;
  const goal = settings.goal || {};
  const pace = goal.type === 'maintain' ? 0 : ((goal.type === 'lose' ? -1 : 1) * (goal.rate_pct / 100) * (model.trendKg || 0));
  const todayRow = summary.days[summary.days.length - 1];

  const rangeCtl = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Range' },
    RANGES.map(([label, d]) => h('button', { role: 'tab', 'aria-selected': String(range === d), onclick: () => { range = d; render(root); } }, label)));

  const weighIns = summary.days.filter(d => d.weight_kg).reverse();
  const byDate = Object.fromEntries(series.map(s => [s.date, s]));

  root.replaceChildren(
    pageHead({ 30: 'Last month', 56: 'Last 8 weeks', 182: 'Last 6 months', 365: 'Last 12 months', 99999: 'All time' }[range], 'Weight',
      [h('button', { class: 'btn sm primary desk-only', onclick: () => openWeightSheet({ onDone: () => render(root) }) }, 'Log weight')]),
    h('div', { class: 'row' },
      h('section', { class: 'card pad-lg grow-3', 'aria-label': 'Weight chart' },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' } },
          h('div', { style: { display: 'flex', flexDirection: 'column' } },
            h('span', { class: 'small muted', style: { fontWeight: 500 } }, 'Trend weight'),
            h('span', { class: 'num', style: { fontSize: '56px', lineHeight: 0.95 } }, fmtW(model.trendKg), h('span', { class: 'unit' }, ` ${wUnit()}`))),
          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingBottom: '6px' } },
            h('span', { class: 'num', style: { fontSize: '22px', fontWeight: 600 } }, model.weeklyChangeKg == null ? '-' : `${signed(toDisplayW(model.weeklyChangeKg))} ${wUnit()}/wk`),
            h('span', { class: 'small muted' }, goal.type === 'maintain' ? 'goal: hold steady' : `goal pace ${signed(toDisplayW(pace))}`))),
        rangeCtl,
        shown.some(s => s.weight != null)
          ? chart({ n: shown.length, w: 640, h: 240,
              dots: [{ values: shown.map(s => toDisplayW(s.weight)), r: shown.length > 120 ? 2 : 3 }],
              lines: [{ values: shown.map(s => toDisplayW(s.trend)), color: 'var(--primary)', endDot: true }],
              xLabels: dateTicks(shown.map(s => s.date)), yFormat: (v) => fmt1(v).replace('.0', ''),
              label: `Scale weights and smoothed trend, now ${fmtW(model.trendKg)} ${wUnit()}` })
          : h('p', { class: 'empty' }, 'Log your first weigh-in to start your trend.'),
        h('div', { class: 'legend' },
          h('span', null, h('i', { style: { width: '8px', height: '8px', borderRadius: '4px', background: 'var(--dot)' } }), 'Scale weight'),
          h('span', null, h('i', { style: { width: '16px', height: '3px', borderRadius: '2px', background: 'var(--primary)' } }), 'Trend')),
        h('p', { class: 'note small' }, 'Daily weight swings with water, salt and food in your system. The trend line smooths those out so you see real change.')),
      h('div', { class: 'grow-2 stack' },
        h('section', { class: 'card', 'aria-label': 'Log today' },
          h('form', { style: { display: 'flex', alignItems: 'flex-end', gap: '10px' }, onsubmit: async (e) => {
            e.preventDefault();
            const v = e.target.querySelector('input').value.replace(',', '.');
            const kg = fromDisplayW(v);
            if (!kg) { toast('Enter a weight', 'error'); return; }
            try {
              const r = await post('weights/save', { date: todayISO(), weight_kg: kg });
              markStale(); toast(r.queued ? 'Saved offline' : 'Weight saved'); render(root);
            } catch (err) { toast(err.message, 'error'); }
          } },
            h('label', { class: 'field', style: { flex: 1 }, for: 'w-today' }, "Today's weigh-in",
              h('input', { class: 'input big', id: 'w-today', inputmode: 'decimal', value: todayRow.weight_kg ? fmtW(todayRow.weight_kg) : '', placeholder: wUnit() })),
            h('button', { class: 'btn primary', type: 'submit', style: { height: '52px' } }, 'Save'))),
        h('section', { class: 'card', 'aria-label': 'Recent weigh-ins' },
          h('h2', null, 'Weigh-ins'),
          weighIns.length ? h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'Day'), h('th', { class: 'r' }, 'Scale'), h('th', { class: 'r' }, 'Trend'), h('th', null, h('span', { class: 'sr' }, 'Edit')))),
            h('tbody', null, weighIns.slice(0, 30).map(d => h('tr', null,
              h('td', null, relDay(d.date)),
              h('td', { class: 'r', style: { fontWeight: 600 } }, fmtW(d.weight_kg)),
              h('td', { class: 'r muted' }, fmtW(byDate[d.date]?.trend)),
              h('td', { class: 'r' }, h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${relDay(d.date)}`, onclick: () => editWeighIn(d, root) }, 'Edit'))))))
            : h('p', { class: 'note' }, 'No weigh-ins yet.')))));
}

function editWeighIn(d, root) {
  const s = openSheet({
    title: relDay(d.date),
    body: h('div', { class: 'stack' },
      h('button', { class: 'btn block', onclick: () => { s.close(); openWeightSheet({ date: d.date, current: d.weight_kg, onDone: () => render(root) }); } }, 'Change weight'),
      h('button', { class: 'btn block danger', onclick: async () => {
        if (!(await confirmSheet('Delete weigh-in?', `This removes the ${fmtW(d.weight_kg)} ${wUnit()} entry for ${relDay(d.date)}.`))) return;
        await post('weights/delete', { date: d.date });
        markStale(); s.close(); toast('Weigh-in deleted'); render(root);
      } }, 'Delete weigh-in')),
  });
}

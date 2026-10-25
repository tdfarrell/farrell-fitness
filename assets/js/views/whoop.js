import { h, icon, fmt0, fmt1, hoursMin, relDay, timeAgo, toast, recoveryColor } from '../ui.js';
import { post } from '../api.js';
import { state, loadSummary, markStale } from '../store.js';
import { pageHead, whoopCard } from '../components.js';
import { chart, dateTicks } from '../charts.js';

let span = 30;

export async function render(root) {
  await loadSummary();
  const { summary } = state;
  const st = summary.whoop;
  const days = summary.days.slice(-span);
  const W = (k) => days.map(d => d.whoop?.[k] ?? null);
  const dates = days.map(d => d.date);
  const latest = [...summary.days].reverse().find(d => d.whoop?.recovery != null || d.whoop?.sleep_hours != null);

  const syncBtn = h('button', { class: 'btn sm', onclick: async (e) => {
    e.target.disabled = true; e.target.textContent = 'Syncing…';
    try { const r = await post('whoop/sync', {}); markStale(); toast(`Synced ${r.days} days`); render(root); }
    catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Sync now'; }
  } }, icon('sync', 18), 'Sync now');

  if (!st.connected) {
    root.replaceChildren(pageHead('Recovery, sleep and strain', 'WHOOP'),
      h('section', { class: 'card', style: { maxWidth: '640px' } },
        h('h2', null, 'Connect WHOOP'),
        h('p', { class: 'note' }, st.configured
          ? 'Sign in with WHOOP to bring in recovery, HRV, resting heart rate, sleep and strain. The first sync pulls the last 90 days.'
          : "WHOOP isn't set up on the server yet. Add your WHOOP client ID and secret to api/config.php, then come back here."),
        st.configured ? h('a', { class: 'btn primary', href: 'api/?r=whoop/connect', style: { alignSelf: 'flex-start' } }, 'Connect WHOOP') : null));
    return;
  }

  const mk = (title, el, sub) => h('section', { class: 'card half', style: { flex: '1 1 420px' }, 'aria-label': title },
    h('div', { class: 'card-head' }, h('h2', null, title), sub ? h('span', { class: 'small muted' }, sub) : null), el);
  const avg = (a) => { const v = a.filter(x => x != null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };

  root.replaceChildren(
    pageHead(`Last synced ${timeAgo(st.last_sync_at)}`, 'WHOOP', [syncBtn]),
    h('div', { class: 'stack' },
      h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Range', style: { maxWidth: '320px' } },
        [[14, '2 weeks'], [30, '30 days'], [90, '90 days']].map(([d, l]) => h('button', { role: 'tab', 'aria-selected': String(span === d), onclick: () => { span = d; render(root); } }, l))),
      h('div', { class: 'row' },
        h('div', { style: { flex: '1 1 360px', display: 'flex' } }, whoopCard(latest?.whoop, st, avg(W('recovery').slice(-7)))),
        mk('Recovery', chart({ n: days.length, w: 520, h: 200, yMin: 0, yMax: 100, bars: [{ values: W('recovery'), colorFn: (v) => recoveryColor(v) }],
          xLabels: dateTicks(dates, 3), yFormat: (v) => `${v}%`, label: `Daily recovery for ${span} days` }), `avg ${fmt0(avg(W('recovery')))}%`)),
      h('div', { class: 'row' },
        mk('HRV', chart({ n: days.length, w: 520, h: 180, lines: [{ values: W('hrv'), color: 'var(--primary)', endDot: true }], dots: [{ values: W('hrv'), color: 'var(--primary)', r: 2.5 }],
          xLabels: dateTicks(dates, 3), yFormat: fmt0, label: `Heart rate variability for ${span} days` }), `avg ${fmt0(avg(W('hrv')))} ms`),
        mk('Resting heart rate', chart({ n: days.length, w: 520, h: 180, lines: [{ values: W('rhr'), color: 'var(--red)', endDot: true }], dots: [{ values: W('rhr'), color: 'var(--red)', r: 2.5 }],
          xLabels: dateTicks(dates, 3), yFormat: fmt0, label: `Resting heart rate for ${span} days` }), `avg ${fmt0(avg(W('rhr')))} bpm`)),
      h('div', { class: 'row' },
        mk('Sleep', chart({ n: days.length, w: 520, h: 180, yMin: 0, bars: [{ values: W('sleep_hours'), color: 'var(--sleep-deep)' }],
          lines: [{ values: W('sleep_need_hours'), color: 'var(--muted)', width: 2, dash: '5 4' }],
          xLabels: dateTicks(dates, 3), yFormat: (v) => `${v}h`, label: `Hours asleep for ${span} days, with sleep need as a dashed line` }), `avg ${hoursMin(avg(W('sleep_hours')))}`),
        mk('Day strain', chart({ n: days.length, w: 520, h: 180, yMin: 0, yMax: 21, bars: [{ values: W('strain'), color: 'var(--ink)' }],
          xLabels: dateTicks(dates, 3), yFormat: fmt0, label: `Day strain for ${span} days` }), `avg ${fmt1(avg(W('strain')))}`)),
      h('section', { class: 'card', 'aria-label': 'Daily detail' },
        h('h2', null, 'Daily detail'),
        h('div', { class: 'scroll-x' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, ...['Day', 'Recovery', 'HRV', 'RHR', 'Sleep', 'Sleep perf.', 'Strain', 'WHOOP kcal'].map((t, i) => h('th', { class: i ? 'r' : '' }, t)))),
          h('tbody', null, [...days].reverse().filter(d => d.whoop).map(d => h('tr', null,
            h('td', null, relDay(d.date)),
            h('td', { class: 'r', style: { fontWeight: 600, color: recoveryColor(d.whoop.recovery) } }, d.whoop.recovery != null ? `${d.whoop.recovery}%` : '-'),
            h('td', { class: 'r' }, fmt0(d.whoop.hrv)), h('td', { class: 'r' }, fmt0(d.whoop.rhr)),
            h('td', { class: 'r' }, hoursMin(d.whoop.sleep_hours)), h('td', { class: 'r' }, d.whoop.sleep_perf != null ? `${d.whoop.sleep_perf}%` : '-'),
            h('td', { class: 'r' }, d.whoop.strain != null ? fmt1(d.whoop.strain) : '-'), h('td', { class: 'r' }, fmt0(d.whoop.kcal)))))))),
      h('p', { class: 'note small' }, 'WHOOP data refreshes hourly once the sync job is set up on the server, and whenever you press Sync now.')));
}

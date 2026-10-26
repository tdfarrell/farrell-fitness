// Nutrients: vitamins, minerals and the things worth limiting, for a day or the 7-day average.
import { h, icon, longDate, todayISO, openSheet, toast } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, markStale } from '../store.js';
import { loading } from '../components.js';
import { NUTRIENTS, GROUPS, targetFor, defaultTarget, fmtAmount } from '../nutrients.js';

let period = 'day';

export async function render(root, params = []) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? params[0] : todayISO();
  root.replaceChildren(loading());
  await loadSummary();
  const data = await get('nutrients', { date });
  const refresh = () => render(root, params);
  const settings = state.settings;
  const view = period === 'day' ? data.day : data.week;
  const totals = view.totals;
  const kcal = state.targets?.kcal || 2000;

  const tabs = h('div', { class: 'segmented big', role: 'tablist', 'aria-label': 'Period' },
    [['day', date === todayISO() ? 'Today' : 'This day'], ['week', '7-day average']].map(([k, l]) =>
      h('button', { role: 'tab', 'aria-selected': String(period === k), onclick: () => { period = k; refresh(); } }, l)));

  const coverage = view.entries
    ? (view.covered >= view.entries
      ? `From all ${view.entries} foods logged${period === 'week' ? ` over ${data.week.days} days` : ''}.`
      : `From ${view.covered} of ${view.entries} foods logged${period === 'week' ? ` over ${data.week.days} days` : ''}. Quick adds and some saved foods have no nutrient details.`)
    : null;

  const row = (n, i) => {
    const v = totals[n.key];
    const target = targetFor(n.key, settings, kcal);
    const pct = target && v != null ? v / target : 0;
    const over = n.kind === 'limit' && pct > 1;
    const met = n.kind === 'goal' && pct >= 1;
    const of = target ? `of ${fmtAmount(target, n.unit)}${n.kind === 'limit' ? ' limit' : ''}` : '';
    let note = '';
    if (v == null) note = 'None of these foods list it.';
    else if (n.kind === 'limit' && target) note = over ? `${fmtAmount(v - target, n.unit)} over the limit.` : `${fmtAmount(target - v, n.unit)} under the limit.`;
    else if (n.kind === 'goal' && target) note = met ? 'Met.' : `${fmtAmount(target - v, n.unit)} to go.`;
    if (n.key === 'sat_fat' && v != null) note += ` ${Math.round((v * 9 / Math.max(1, view.kcal || kcal)) * 100)}% of calories.`;
    if (n.key === 'vit_d') note += ' From food only. Supplements don’t count here.';
    const sources = period === 'day' ? data.day.sources?.[n.key] : null;
    const label = `${n.name}: ${v == null ? 'no data' : fmtAmount(v, n.unit)} ${of}`;
    const body = [
      h('span', { class: 'nut-head' },
        h('span', { class: 'title' }, n.name),
        h('span', { class: 'small' }, h('b', { class: over ? 'nut-over' : '' }, v == null ? '-' : fmtAmount(v, n.unit)), h('span', { class: 'muted' }, of ? ` ${of}` : ''))),
      target ? h('span', { class: 'nut-bar', role: 'img', 'aria-label': label },
        h('span', { class: 'nut-fill ' + (n.kind === 'limit' ? (over ? 'over' : 'limit') : met ? 'met' : 'goal'), style: { width: `${Math.min(100, pct * 100)}%` } })) : null,
      note.trim() ? h('span', { class: 'tiny muted' }, note.trim()) : null,
    ].filter(Boolean);
    return sources?.length
      ? h('button', { class: 'nut-row', style: { borderTop: i ? '1px solid var(--rule)' : '0' }, 'aria-label': `${label}. Show sources`, onclick: () => showSources(n, sources) }, ...body)
      : h('div', { class: 'nut-row', style: { borderTop: i ? '1px solid var(--rule)' : '0' } }, ...body);
  };

  const groups = GROUPS.map(([g, title]) => h('section', { class: 'card', 'aria-label': title, style: { gap: '0' } },
    h('h2', { style: { marginBottom: '4px' } }, title),
    ...NUTRIENTS.filter(n => n.group === g).map(row)));

  const sodium = period === 'day' ? data.day.sources?.sodium : null;
  const sodiumCard = sodium?.length ? h('section', { class: 'card', 'aria-label': "Where today's sodium came from", style: { gap: '8px' } },
    h('h2', null, date === todayISO() ? "Where today's sodium came from" : 'Where the sodium came from'),
    ...sodium.slice(0, 3).map(s => h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px' } }, h('span', null, s.name), h('span', { style: { fontWeight: 600, whiteSpace: 'nowrap' } }, fmtAmount(s.value, 'mg')))),
    h('span', { class: 'tiny muted' }, 'Tap any nutrient above to see its sources.')) : null;

  const backfill = data.missing > 0 ? h('section', { class: 'banner info', style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' } },
    h('span', null, `${data.missing} of your saved foods were added before nutrients were tracked.`),
    h('button', { class: 'btn sm', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        let r;
        do {
          b.textContent = 'Filling in…';
          r = await post('foods/backfill');
        } while (r.missing > 0 && r.foods > 0 && !r.error);
        toast(r.error ? r.error : 'Nutrients filled in', r.error ? 'error' : '');
        markStale(); refresh();
      } catch (err) { toast(err.message, 'error'); b.disabled = false; b.textContent = 'Fill them in'; }
    } }, 'Fill them in')) : null;

  root.replaceChildren(
    h('div', { class: 'date-nav' },
      h('a', { class: 'icon-btn', href: `#/food/${date === todayISO() ? 'diary' : date}`, 'aria-label': 'Back to the food log' }, icon('left')),
      h('div', { class: 'center' }, h('h1', null, 'Nutrients'), h('span', { class: 'muted', style: { fontSize: '14px' } }, longDate(date))),
      h('button', { class: 'btn sm', onclick: () => openTargets(settings, kcal, refresh) }, 'Targets')),
    h('div', { class: 'stack', style: { maxWidth: '720px' } },
      tabs,
      coverage ? h('p', { class: 'note small', style: { margin: '0 4px' } }, coverage)
        : h('p', { class: 'note', style: { margin: '0 4px' } }, period === 'day' ? 'Nothing logged this day yet.' : 'Nothing logged in the last 7 days.'),
      backfill,
      ...(view.entries ? groups : []),
      view.entries ? sodiumCard : null));
}

function showSources(n, list) {
  openSheet({
    title: `${n.name} sources`,
    body: h('div', { class: 'list' }, list.map(s => h('div', { class: 'list-row' },
      h('div', { class: 'main' }, h('span', { class: 'title' }, s.name)),
      h('span', { style: { fontWeight: 600, whiteSpace: 'nowrap' } }, fmtAmount(s.value, n.unit))))),
  });
}

function openTargets(settings, kcal, onSaved) {
  const inputs = {};
  const s = openSheet({
    title: 'Nutrient targets',
    tall: true,
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      // Blank means "use the default"; 0 tells the server to forget a saved one.
      const patch = {};
      for (const [k, el] of Object.entries(inputs)) {
        const v = parseFloat(el.value.replace(',', '.'));
        patch[k] = Number.isNaN(v) || v <= 0 ? 0 : v;
      }
      try { await post('settings', { nutrient_targets: patch }); markStale(); s.close(); toast('Targets saved'); onSaved(); }
      catch (err) { toast(err.message, 'error'); }
    } },
      h('p', { class: 'note' }, 'Leave a box blank to use the standard target for your age and sex. Saturated fat defaults to 10% of your calories.'),
      ...NUTRIENTS.filter(n => n.kind !== 'info').map(n => {
        const def = defaultTarget(n.key, settings, kcal);
        const own = settings.nutrient_targets?.[n.key];
        const id = `nt-${n.key}`;
        inputs[n.key] = h('input', { id, inputmode: 'decimal', placeholder: String(def), value: own ? String(own) : '' });
        return h('label', { class: 'field nut-target', for: id }, `${n.name} (${n.unit}${n.kind === 'limit' ? ', limit' : ''})`, inputs[n.key]);
      }),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save targets')),
  });
}


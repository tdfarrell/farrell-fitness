// Diet phases planner: a timeline of fat loss, breaks, reverse diets and maintenance.
import { h, icon, fmt0, fmt1, shortDate, todayISO, openSheet, toast, confirmSheet } from '../ui.js';
import { post } from '../api.js';
import { state, loadSummary, markStale, fmtW, wUnit, toDisplayW, fromDisplayW } from '../store.js';
import { pageHead } from '../components.js';
import { addDays, daysBetween } from '../tdee.js';
import { PHASE_TYPES, TEMPLATES, withIds, proposeTargets } from '../phases.js';
import { gripHandle, makeSortable } from '../sortable.js';

const md = (iso) => shortDate(iso).split(', ').slice(1).join(', ');
const wkd = (iso) => shortDate(iso);

function howText(p) {
  if (p.type === 'lose' || p.type === 'gain') return `${fmt1(p.rate_pct).replace('.0', '')}% a week`;
  if (p.type === 'reverse') return `+${p.step_kcal || 75} kcal a week until expenditure`;
  if (p.type === 'break') return 'At maintenance';
  return 'Hold weight';
}
function whenText(p) {
  const until = p.until_kg && !p.weeks && (p.type === 'lose' || p.type === 'gain');
  if (p.end == null) return `From ${p.status === 'future' ? 'about ' : ''}${md(p.start)}, no end date`;
  const wks = Math.round(p.weeks_long);
  const range = `${p.status === 'future' && p.projected ? 'About ' : ''}${md(p.start)} to ${p.projected ? 'about ' : ''}${md(p.end)}`;
  if (until) return `Until trend weight reaches ${fmtW(p.until_kg)} ${wUnit()}. ${range}`;
  const proj = (p.type === 'lose' || p.type === 'gain') && p.end_kg ? `. Projected ${fmtW(p.end_kg)} ${wUnit()}` : '';
  return `${range}, ${wks} week${wks === 1 ? '' : 's'}${proj}`;
}

async function save(plan, root) {
  try {
    const r = await post('settings', { phases: plan });
    state.settings = r.settings; markStale();
    render(root);
  } catch (e) { toast(e.message, 'error'); }
}

export async function render(root) {
  await loadSummary();
  const { settings, phases, model, summary } = state;
  const today = todayISO();
  const plan = { start: settings.phases.start, items: settings.phases.items.map(i => ({ ...i })) };
  const current = phases.find(p => p.status === 'current') || null;
  const next = current ? phases[current.index + 1] : phases.find(p => p.status === 'future');

  const head = pageHead(settings.program === 'manual' ? 'Turn on coached targets in Settings to use phases' : 'Coached targets follow this plan', 'Diet phases');

  if (!plan.items.length) {
    root.replaceChildren(head, h('div', { class: 'stack', style: { maxWidth: '720px' } },
      h('section', { class: 'card' },
        h('h2', null, 'Plan your phases'),
        h('p', { class: 'note' }, 'Line up fat loss, diet breaks, a reverse diet and maintenance. Each weekly check-in sets targets from the phase you’re in, and a new phase starting makes a check-in due.'),
        h('button', { class: 'btn primary', onclick: () => openEditor(null, plan, root) }, 'Add a phase')),
      templatesCard(plan, root)));
    return;
  }

  const nowCard = current ? (() => {
    const t = proposeTargets(model, settings, summary.checkins, today, phases);
    const wkNum = Math.floor(daysBetween(current.start, today) / 7) + 1;
    const totalWk = current.end ? Math.round(current.weeks_long) : null;
    const left = current.end ? Math.max(0, Math.ceil(daysBetween(today, current.end) / 7)) : null;
    const nextLine = next ? (() => {
      const nt = proposeTargets(model, settings, [], next.start, phases);
      return `Next: ${PHASE_TYPES[next.type].name.toLowerCase()} from ${md(next.start)}${next.type === 'break' || next.type === 'maintain' ? `. Your check-in that week moves calories to maintenance, about ${fmt0(Math.round(model.expenditure / 5) * 5)}.` : next.type === 'reverse' ? '. Calories then rise each week until they reach your expenditure.' : `, about ${fmt0(nt.kcal)} kcal.`}`;
    })() : 'This is the last phase in your plan.';
    return h('section', { class: 'card phase-now', 'aria-label': 'Current phase' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' } },
        h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('span', { class: 'small on-deep-muted' }, totalWk ? `Now, week ${Math.min(wkNum, totalWk)} of ${totalWk}` : `Now, week ${wkNum}`),
          h('span', { class: 'phase-now-title' }, PHASE_TYPES[current.type].name),
          h('span', { class: 'small on-deep-muted' }, `${howText(current)}, about ${fmt0(t.kcal)} kcal.${current.end ? ` Until ${wkd(current.end)}.` : ''}`)),
        left != null ? h('span', { class: 'stat', style: { alignItems: 'flex-end', flex: 'none' } },
          h('span', { class: 'phase-now-left' }, `${left} wk`), h('span', { class: 'tiny on-deep-muted' }, 'left')) : null),
      totalWk ? h('div', { class: 'phase-progress', role: 'img', 'aria-label': `${Math.min(wkNum - 1, totalWk)} of ${totalWk} weeks done` },
        h('div', { style: { width: `${Math.min(100, (daysBetween(current.start, today) / (totalWk * 7)) * 100)}%` } })) : null,
      h('span', { class: 'small on-deep-muted' }, nextLine));
  })() : h('section', { class: 'card' },
    h('h2', null, phases[0]?.start > today ? `Your plan starts ${wkd(phases[0].start)}` : 'Your plan has finished'),
    h('p', { class: 'note' }, phases[0]?.start > today ? 'Until then, check-ins use the goal in Settings.' : 'Check-ins use the goal in Settings again. Add a phase to keep going.'));

  // Timeline: each phase's width is its length; open-ended last phases get a short stub.
  const first = phases[0].start;
  const endOf = (p) => p.end || addDays(p.start, 27);
  const last = endOf(phases[phases.length - 1]);
  const span = Math.max(1, daysBetween(first, last) + 1);
  const months = [];
  for (let d = new Date(first + 'T12:00:00'); d.toISOString().slice(0, 10) <= last; d.setMonth(d.getMonth() + 1, 1)) months.push(d.toLocaleDateString('en-US', { month: 'short' }));
  const todayPct = today >= first && today <= last ? (daysBetween(first, today) / span) * 100 : null;
  const timeline = h('section', { class: 'card', 'aria-label': 'Timeline', style: { gap: '10px' } },
    h('div', { class: 'card-head' }, h('h2', null, 'Your plan'), h('span', { class: 'small muted' }, `${md(first)} to ${phases[phases.length - 1].end ? md(last) : 'ongoing'}`)),
    h('div', { class: 'phase-line', role: 'img', 'aria-label': 'Timeline: ' + phases.map(p => `${PHASE_TYPES[p.type].name} ${p.end ? `to ${md(p.end)}` : 'ongoing'}`).join(', ') },
      h('div', { class: 'phase-segs' }, phases.map(p => h('div', { style: { flex: String(daysBetween(p.start, endOf(p)) + 1), background: PHASE_TYPES[p.type].color, opacity: p.end ? 1 : 0.55 } }))),
      todayPct != null ? h('div', { class: 'phase-today', style: { left: `${todayPct}%` } }) : null),
    h('div', { class: 'phase-months', 'aria-hidden': 'true' }, months.slice(0, 8).map(m => h('span', null, m))),
    h('div', { class: 'legend' }, [['lose', 'Fat loss'], ['break', 'Diet break or maintenance'], ['reverse', 'Reverse diet'], ['gain', 'Lean gain']]
      .filter(([k]) => phases.some(p => p.type === k || (k === 'break' && p.type === 'maintain')))
      .map(([k, l]) => h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '2px', background: PHASE_TYPES[k].color } }), l))));

  const list = h('div', { class: 'list phase-list' }, phases.map(p => h('div', { class: 'list-row phase-row' + (p.status === 'current' ? ' now' : ''), 'data-key': p.id, 'data-label': PHASE_TYPES[p.type].name },
    gripHandle(PHASE_TYPES[p.type].name),
    h('span', { class: 'phase-swatch', style: { background: PHASE_TYPES[p.type].color }, 'aria-hidden': 'true' }),
    h('button', { class: 'main', style: { background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }, onclick: () => openEditor(plan.items[p.index], plan, root) },
      h('span', { class: 'title' }, PHASE_TYPES[p.type].name),
      h('span', { class: 'small muted' }, howText(p)),
      h('span', { class: 'tiny muted' }, whenText(p))),
    p.status === 'current' ? h('span', { class: 'badge now-badge' }, 'Now') : p.status === 'past' ? h('span', { class: 'badge' }, 'Done') : null)));
  // Phases that haven't been shown (after an open-ended one) still appear so they can be fixed.
  plan.items.slice(phases.length).forEach(it => list.append(h('div', { class: 'list-row phase-row', 'data-key': it.id, 'data-label': PHASE_TYPES[it.type].name },
    gripHandle(PHASE_TYPES[it.type].name),
    h('span', { class: 'phase-swatch', style: { background: PHASE_TYPES[it.type].color }, 'aria-hidden': 'true' }),
    h('button', { class: 'main', style: { background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }, onclick: () => openEditor(it, plan, root) },
      h('span', { class: 'title' }, PHASE_TYPES[it.type].name), h('span', { class: 'small muted' }, 'Never starts: the phase before it has no end')))));
  makeSortable(list, { onChange: (keys) => { plan.items = keys.map(k => plan.items.find(i => i.id === k)); save(plan, root); } });

  const startIn = h('input', { id: 'ph-start', type: 'date', value: plan.start, onchange: (e) => { if (e.target.value) save({ ...plan, start: e.target.value }, root); } });

  root.replaceChildren(head, h('div', { class: 'stack', style: { maxWidth: '720px' } },
    nowCard, timeline,
    h('section', { class: 'card', 'aria-label': 'Phases', style: { gap: '4px' } }, list),
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn primary', onclick: () => openEditor(null, plan, root) }, 'Add a phase'),
      h('button', { class: 'btn', onclick: () => openTemplates(plan, root) }, 'Use a template')),
    h('section', { class: 'card', style: { gap: '8px' } },
      h('label', { class: 'field', for: 'ph-start' }, 'The first phase starts on', startIn),
      h('p', { class: 'note small' }, 'A phase can end on a set number of weeks, or when trend weight reaches a number. Projected dates use your rate and update with every check-in.'),
      h('button', { class: 'btn sm danger', style: { alignSelf: 'flex-start' }, onclick: async () => {
        if (!(await confirmSheet('Clear your plan?', 'Check-ins go back to the goal in Settings. Past check-ins stay.', 'Clear'))) return;
        save({ start: null, items: [] }, root);
      } }, 'Clear plan'))));
}

function templatesCard(plan, root) {
  return h('section', { class: 'card', 'aria-label': 'Templates' },
    h('h2', null, 'Start from a template'),
    h('div', { class: 'list' }, TEMPLATES.map(t => h('button', { class: 'list-row', onclick: () => applyTemplate(t, plan, root) },
      h('div', { class: 'main' }, h('span', { class: 'title' }, t.name), h('span', { class: 'small muted' }, t.desc)), icon('right', 18)))));
}

function openTemplates(plan, root) {
  const s = openSheet({ title: 'Use a template', body: h('div', { class: 'list' }, TEMPLATES.map(t => h('button', { class: 'list-row', onclick: () => { s.close(); applyTemplate(t, plan, root); } },
    h('div', { class: 'main' }, h('span', { class: 'title' }, t.name), h('span', { class: 'small muted' }, t.desc)), icon('right', 18)))) });
}

async function applyTemplate(t, plan, root) {
  if (plan.items.length && !(await confirmSheet(`Replace your plan with ${t.name.toLowerCase()}?`, 'Your current phases are replaced, starting today. Past check-ins stay.', 'Replace'))) return;
  save({ start: todayISO(), items: withIds(t.items) }, root);
}

function openEditor(item, plan, root) {
  const isNew = !item;
  const p = item ? { ...item } : { type: 'lose', rate_pct: 0.5, weeks: 8, until_kg: null, step_kcal: 75 };
  let endMode = p.until_kg && !p.weeks ? 'weight' : p.weeks ? 'weeks' : p.type === 'reverse' ? 'auto' : 'none';
  const s = openSheet({
    title: isNew ? 'Add a phase' : `Edit ${PHASE_TYPES[p.type].name.toLowerCase()}`,
    body: (sheet) => {
      const form = h('form', { class: 'stack', onsubmit: (e) => {
        e.preventDefault();
        const f = e.target;
        const num = (id) => parseFloat((f.querySelector('#' + id)?.value || '').replace(',', '.'));
        const out = { id: p.id, type: p.type, rate_pct: 0, weeks: null, until_kg: null, step_kcal: null };
        if (p.type === 'lose' || p.type === 'gain') {
          out.rate_pct = num('pe-rate');
          if (!(out.rate_pct > 0)) { toast('Enter a weekly rate', 'error'); return; }
        }
        if (p.type === 'reverse') out.step_kcal = Math.round(num('pe-step') || 75);
        if (endMode === 'weeks') { out.weeks = Math.round(num('pe-weeks')); if (!(out.weeks >= 1)) { toast('Enter how many weeks', 'error'); return; } }
        if (endMode === 'weight') { out.until_kg = fromDisplayW(num('pe-until')); if (!(out.until_kg > 0)) { toast('Enter a target weight', 'error'); return; } }
        const items = plan.items.map(i => ({ ...i }));
        if (isNew) items.push({ ...out, id: Math.random().toString(36).slice(2, 10) });
        else items[items.findIndex(i => i.id === p.id)] = out;
        sheet.close();
        save({ start: plan.start || todayISO(), items }, root);
      } });
      const draw = () => {
        const lg = p.type === 'lose' || p.type === 'gain';
        const ends = [['weeks', 'After a number of weeks'], ...(lg ? [['weight', 'When trend weight reaches']] : []), ...(p.type === 'reverse' ? [['auto', 'When calories reach expenditure']] : []), ['none', 'No end (last phase)']];
        if (!ends.some(e => e[0] === endMode)) endMode = ends[0][0];
        form.replaceChildren(...[
          h('div', { class: 'pills', role: 'group', 'aria-label': 'Phase type' }, Object.entries(PHASE_TYPES).map(([k, t]) =>
            h('button', { type: 'button', class: 'pill', 'aria-pressed': String(p.type === k), onclick: () => {
              p.type = k;
              if ((k === 'lose' || k === 'gain') && !p.rate_pct) p.rate_pct = k === 'gain' ? 0.25 : 0.5;
              if (k === 'break' && endMode !== 'weeks') { endMode = 'weeks'; p.weeks = p.weeks || 2; }
              if (k === 'reverse' && isNew) endMode = 'auto';
              draw();
            } }, t.name))),
          lg ? h('label', { class: 'field', for: 'pe-rate' }, `Rate (% of body weight a week, about ${fmt1(Math.abs(toDisplayW(((p.rate_pct || 0.5) / 100) * (state.model.trendKg || 80))))} ${wUnit()})`,
            h('input', { id: 'pe-rate', inputmode: 'decimal', value: String(p.rate_pct || (p.type === 'gain' ? 0.25 : 0.5)), oninput: (e) => { p.rate_pct = parseFloat(e.target.value) || 0; } })) : null,
          p.type === 'reverse' ? h('label', { class: 'field', for: 'pe-step' }, 'Add each week (kcal)', h('input', { id: 'pe-step', inputmode: 'numeric', value: String(p.step_kcal || 75) })) : null,
          h('fieldset', { class: 'plain-fieldset' },
            h('legend', { class: 'small muted' }, 'Ends'),
            ...ends.map(([k, l]) => h('label', { class: 'check', style: { minHeight: '40px' } },
              h('input', { type: 'radio', name: 'pe-end', checked: endMode === k, onchange: () => { endMode = k; draw(); } }), l))),
          endMode === 'weeks' ? h('label', { class: 'field', for: 'pe-weeks' }, 'Weeks', h('input', { id: 'pe-weeks', inputmode: 'numeric', value: String(p.weeks || (p.type === 'break' ? 2 : 8)) })) : null,
          endMode === 'weight' ? h('label', { class: 'field', for: 'pe-until' }, `Trend weight (${wUnit()})`, h('input', { id: 'pe-until', inputmode: 'decimal', value: p.until_kg ? fmtW(p.until_kg) : '' })) : null,
          p.type === 'break' ? h('p', { class: 'note small' }, 'Diet breaks of 1 to 2 weeks at maintenance are common every 8 to 12 weeks of a cut.') : null,
          h('button', { class: 'btn primary block', type: 'submit' }, isNew ? 'Add phase' : 'Save'),
          !isNew ? h('button', { class: 'btn block danger', type: 'button', onclick: () => {
            sheet.close();
            save({ start: plan.start, items: plan.items.filter(i => i.id !== p.id) }, root);
          } }, 'Delete phase') : null].filter(Boolean));
      };
      draw();
      sheet.body.append(form);
    },
  });
  return s;
}

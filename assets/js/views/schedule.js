// Workout schedule: the Schedule screen, the editor sheet, and helpers the Train overview and Today use
// (where Start goes, moving or skipping one date).
import { h, icon, todayISO, shortDate, openSheet, toast, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary } from '../store.js';
import { pageHead, loading } from '../components.js';
import { addDays } from '../tdee.js';
import { ACTIVITIES, SETTINGS, SETTING_NAME } from './cardio.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const KIND_LABEL = { strength: 'Strength', cardio: 'Cardio', stretch: 'Stretching' };
const REMIND = [[null, 'No reminder'], [0, 'At the start time'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [120, '2 hours before']];

/** "6 am", "6:30 pm" from "06:00". */
export function clock(hhmm) {
  if (!hhmm) return '';
  const [hr, mi] = hhmm.split(':').map(Number);
  const d = new Date(); d.setHours(hr, mi, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: mi ? '2-digit' : undefined }).toLowerCase();
}
export const occTitle = (o) => `${o.title}${o.detail ? `, ${o.detail}` : ''}`;
export const whenText = (o) => {
  const t = todayISO();
  const day = o.date === t ? 'Today' : o.date === addDays(t, 1) ? 'Tomorrow' : shortDate(o.date);
  return `${day}${o.time ? `, ${clock(o.time)}` : ''}`;
};

export async function loadSchedule(from, to) { return get('schedule', { from, to }); }

/** Where Start goes for a planned session: the warm-up first if it has one, then the session. */
export function startHref(o) {
  const after = o.cooldown_id ? `cooldown=${o.cooldown_id}` : '';
  let target;
  if (o.kind === 'strength') target = `#/train/new?routine=${o.ref_id}&nowarm=1${after ? `&${after}` : ''}`;
  else if (o.kind === 'cardio') target = `#/train/cardio/new?activity=${encodeURIComponent(o.activity || 'Run')}${o.setting ? `&setting=${o.setting}` : ''}&date=${o.date}${after ? `&${after}` : ''}`;
  else target = `#/train/stretch/run/${o.ref_id}`;
  return o.warmup_id && o.kind !== 'stretch' ? `#/train/stretch/run/${o.warmup_id}?next=${encodeURIComponent(target)}` : target;
}

export async function skipOcc(o, onDone) {
  const r = await post('schedule/exception', { id: o.schedule_id, date: o.moved_from || o.date, action: 'skip' });
  toast(`Skipped ${o.title}`); onDone?.(r);
}

export function moveSheet(o, onDone) {
  const dateIn = h('input', { type: 'date', id: 'mv-date', value: o.date, min: todayISO() });
  const timeIn = h('input', { type: 'time', id: 'mv-time', value: o.time || '' });
  const s = openSheet({
    title: `Move ${o.title}`,
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const r = await post('schedule/exception', { id: o.schedule_id, date: o.moved_from || o.date, action: 'move', to_date: dateIn.value, to_time: timeIn.value });
      s.close(); toast(`Moved to ${whenText({ date: dateIn.value, time: timeIn.value })}`); onDone?.(r);
    } },
      h('p', { class: 'note' }, `Just this one. ${o.repeat === 'once' ? '' : 'The rest of the schedule stays as it is.'}`),
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'mv-date' }, 'Day', dateIn), h('label', { class: 'field', for: 'mv-time' }, 'Time', timeIn)),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Move it')),
  });
}

function repeatText(s) {
  if (s.repeat === 'once') return `Once, ${shortDate(s.start_date)}`;
  if (s.repeat === 'days') return s.every_n === 1 ? 'Every day' : `Every ${s.every_n} days`;
  return s.every_n === 1 ? 'Every week' : `Every ${s.every_n} weeks`;
}

/* ---------- the Schedule screen ---------- */

export async function render(root) {
  root.replaceChildren(loading());
  await loadSummary();
  const today = todayISO();
  const [data, rt, st] = await Promise.all([loadSchedule(addDays(today, -60), addDays(today, 120)), get('routines'), get('stretch')]);
  const refresh = () => render(root);
  const ctx = { routines: rt.routines, stretch: st.routines, onDone: refresh };
  const stretchName = Object.fromEntries(st.routines.map(r => [r.id, r.name]));
  const color = (k) => (k === 'strength' ? 'var(--lift)' : k === 'cardio' ? 'var(--kcal)' : 'var(--green)');

  const rep = data.schedule.filter(s => s.repeat !== 'once').sort((a, b) => {
    const da = a.repeat === 'weekly' ? (a.weekdays.map(d => (d + 6) % 7)[0] ?? 9) : 8, db = b.repeat === 'weekly' ? (b.weekdays.map(d => (d + 6) % 7)[0] ?? 9) : 8;
    return da - db || (a.time || '') .localeCompare(b.time || '');
  });
  const once = data.schedule.filter(s => s.repeat === 'once' && s.start_date >= today);
  const row = (s, left, sub) => h('button', { class: 'sched-row', onclick: () => editSchedule(s, ctx) },
    h('span', { class: 'sched-when' }, h('b', null, left[0]), h('span', { class: 'tiny muted' }, left[1])),
    h('span', { class: 'sched-bar', style: { background: color(s.kind) }, 'aria-hidden': 'true' }),
    h('span', { class: 'main' }, h('span', { class: 'title' }, `${s.title}${s.detail ? `, ${s.detail}` : ''}`), h('span', { class: 'small muted' }, sub)),
    icon('right', 18));
  const subOf = (s) => [repeatText(s), s.kind === 'cardio' && s.setting ? SETTING_NAME[s.setting].toLowerCase() : null,
    s.warmup_id && stretchName[s.warmup_id] ? 'warm-up attached' : null, s.cooldown_id && stretchName[s.cooldown_id] ? 'cool-down attached' : null].filter(Boolean).join('. ').replace(/\. (\w)/g, (m, c) => `, ${c}`);
  const weeklyCount = (k) => rep.filter(s => s.kind === k && s.repeat === 'weekly').reduce((a, s) => a + s.weekdays.length / Math.max(1, s.every_n), 0);
  const lifts = weeklyCount('strength'), cardio = weeklyCount('cardio');

  const repCard = h('section', { class: 'card', 'aria-label': 'Repeating', style: { gap: 0 } },
    h('div', { class: 'card-head', style: { alignItems: 'baseline' } }, h('h2', null, 'Repeating'),
      rep.length ? h('span', { class: 'small muted' }, `${+lifts.toFixed(1)} lift${lifts === 1 ? '' : 's'}, ${+cardio.toFixed(1)} cardio a week`) : null),
    rep.length ? h('div', { class: 'list' }, rep.map(s => row(s,
      s.repeat === 'weekly' ? [s.weekdays.length === 7 ? 'Daily' : s.weekdays.map(d => DOW[d]).join(' '), clock(s.time)] : [`${s.every_n}d`, clock(s.time)], subOf(s))))
      : h('p', { class: 'note' }, 'Plan your week: add each session with its days and time. Scheduled sessions show on the Train overview and can remind you before they start.'));
  const onceCard = once.length ? h('section', { class: 'card', 'aria-label': 'One-off', style: { gap: 0 } }, h('h2', null, 'One-off'),
    h('div', { class: 'list' }, once.map(s => row(s, [shortDate(s.start_date).split(', ')[1], clock(s.time)], subOf(s))))) : null;

  // Skipped and moved dates still ahead (or in the last week), with undo.
  const changes = data.schedule.flatMap(s => Object.entries(s.exceptions || {}).filter(([d, e]) => d >= addDays(today, -7) || (e?.date && e.date >= today))
    .map(([d, e]) => ({ s, d, e }))).sort((a, b) => (a.d < b.d ? -1 : 1));
  const changeCard = changes.length ? h('section', { class: 'card', 'aria-label': 'Skipped and moved', style: { gap: 0 } }, h('h2', null, 'Skipped and moved'),
    h('div', { class: 'list' }, changes.map(({ s, d, e }) => h('div', { class: 'list-row' },
      h('div', { class: 'main' }, h('span', { class: 'title' }, `${s.title} ${e === 'skip' ? 'skipped' : 'moved'}`),
        h('span', { class: 'small muted' }, e === 'skip' ? shortDate(d) : `${shortDate(d)}${s.time ? `, ${clock(s.time)}` : ''} to ${shortDate(e.date)}${e.time || s.time ? `, ${clock(e.time || s.time)}` : ''}`)),
      h('button', { class: 'btn sm ghost', onclick: async () => { await post('schedule/exception', { id: s.id, date: d, action: 'restore' }); toast('Back on the schedule'); refresh(); } }, 'Undo'))))) : null;

  const sset = state.settings.schedule || {};
  const showToday = h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: sset.show_today !== false, 'aria-label': 'Show on Today',
    onchange: async (e) => { await post('settings', { schedule: { show_today: e.target.checked } }); state.stale = true; } });
  const remSel = h('select', { class: 'input', style: { width: 'auto', height: '40px' }, 'aria-label': 'Default reminder', onchange: async (e) => {
    const v = e.target.value === '' ? null : +e.target.value; await post('settings', { schedule: { remind_min: v } }); state.settings.schedule = { ...sset, remind_min: v }; } },
    REMIND.map(([v, l]) => h('option', { value: v ?? '', selected: (sset.remind_min ?? 30) === v }, l)));
  const setCard = h('section', { class: 'card', 'aria-label': 'Schedule settings', style: { gap: 0, paddingTop: '6px', paddingBottom: '6px' } },
    h('label', { class: 'set-row-line' }, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Show on Today'), h('span', { class: 'small muted' }, "The day's sessions on the Today screen")), showToday),
    h('div', { class: 'set-row-line' }, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Default reminder'), h('span', { class: 'small muted' }, 'For new sessions. Change it per session')), remSel));

  root.replaceChildren(
    pageHead('Training', 'Schedule', [h('button', { class: 'btn sm primary', onclick: () => editSchedule(null, ctx) }, icon('plus', 18), 'Add')]),
    h('div', { class: 'stack', style: { maxWidth: '720px' } }, repCard, onceCard, changeCard, setCard));
}

/* ---------- editor ---------- */

/**
 * Add or edit a scheduled session. `occ` (optional) is the date it was opened from, for "just this date".
 * ctx: { routines, stretch, onDone }
 */
export function editSchedule(s, ctx, occ = null) {
  const d = s || { kind: 'strength', repeat: 'weekly', weekdays: [new Date().getDay()], every_n: 1, start_date: todayISO(), time: '06:00',
    remind_min: state.settings.schedule?.remind_min ?? 30, activity: 'Run', setting: 'road' };
  let kind = d.kind, repeat = d.repeat, days = new Set(d.weekdays || []), activity = d.activity || 'Run', setting = d.setting || 'road';
  const body = h('form', { class: 'stack sched-form' });
  const opt = (v, l, sel) => h('option', { value: v, selected: sel }, l);
  const refSel = h('select', { id: 'sc-ref' });
  const actSel = h('select', { id: 'sc-act', onchange: () => { activity = actSel.value; setting = (SETTINGS[activity] || [])[0] ? (SETTINGS[activity].includes(setting) ? setting : 'road') : null; draw(); } }, ACTIVITIES.map(a => opt(a, a, a === activity)));
  const setSel = h('select', { id: 'sc-set', onchange: () => { setting = setSel.value; } });
  const detailIn = h('input', { id: 'sc-detail', value: d.detail || '', placeholder: 'e.g. 5 km, 30 min, intervals' });
  const everyIn = h('input', { id: 'sc-every', inputmode: 'numeric', value: d.every_n || 1, style: { width: '72px' } });
  const timeIn = h('input', { id: 'sc-time', type: 'time', value: d.time || '' });
  const startIn = h('input', { id: 'sc-start', type: 'date', value: d.start_date || todayISO() });
  const warmSel = h('select', { id: 'sc-warm' }, opt('', 'None'), ctx.stretch.map(r => opt(r.id, r.name, r.id === d.warmup_id)));
  const coolSel = h('select', { id: 'sc-cool' }, opt('', 'None'), ctx.stretch.map(r => opt(r.id, r.name, r.id === d.cooldown_id)));
  const remSel = h('select', { id: 'sc-rem' }, REMIND.map(([v, l]) => opt(v ?? '', l, (d.remind_min ?? null) === v)));
  const kindBox = h('div', { class: 'segmented big', role: 'radiogroup', 'aria-label': 'Kind' });
  const repBox = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Repeats' });
  const dayBox = h('div', { class: 'day-pick', role: 'group', 'aria-label': 'Days' });
  const refField = h('label', { class: 'field', for: 'sc-ref' }, 'Routine', refSel);
  const cardioFields = h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'sc-act' }, 'Activity', actSel), h('label', { class: 'field', for: 'sc-set' }, 'Where', setSel));
  const detailField = h('label', { class: 'field', for: 'sc-detail' }, 'Plan (optional)', detailIn);
  const everyField = h('label', { class: 'field inline', for: 'sc-every' }, h('span', { class: 'every-label' }, 'Every'), everyIn, h('span', { class: 'every-unit' }, ''));
  const attachFields = h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'sc-warm' }, 'Warm-up', warmSel), h('label', { class: 'field', for: 'sc-cool' }, 'Cool-down', coolSel));

  const draw = () => {
    kindBox.replaceChildren(...['strength', 'cardio', 'stretch'].map(k => h('button', { type: 'button', role: 'radio', 'aria-checked': String(kind === k), onclick: () => { kind = k; draw(); } }, KIND_LABEL[k])));
    const refs = kind === 'strength' ? ctx.routines : ctx.stretch;
    refField.firstChild.textContent = kind === 'stretch' ? 'Stretching routine' : 'Routine';
    if (kind !== 'cardio') refSel.replaceChildren(...refs.map(r => opt(r.id, r.name, r.id === (d.kind === kind ? d.ref_id : null))));
    refField.hidden = kind === 'cardio';
    cardioFields.hidden = kind !== 'cardio';
    setSel.replaceChildren(...(SETTINGS[activity] || []).map(k => opt(k, SETTING_NAME[k], k === setting)));
    setSel.disabled = !SETTINGS[activity];
    if (!SETTINGS[activity]) setSel.replaceChildren(opt('', 'Anywhere', true));
    detailField.hidden = kind !== 'cardio';
    attachFields.hidden = kind === 'stretch' || !ctx.stretch.length;
    repBox.replaceChildren(...[['weekly', 'Weekly'], ['days', 'Every N days'], ['once', 'Once']].map(([k, l]) =>
      h('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(repeat === k), onclick: () => { repeat = k; draw(); } }, l)));
    dayBox.hidden = repeat !== 'weekly';
    dayBox.replaceChildren(...[1, 2, 3, 4, 5, 6, 0].map(n => h('button', { type: 'button', 'aria-pressed': String(days.has(n)), 'aria-label': DOW_LONG[n],
      onclick: () => { days.has(n) ? days.delete(n) : days.add(n); draw(); } }, DOW[n][0])));
    everyField.hidden = repeat === 'once';
    everyField.querySelector('.every-unit').textContent = repeat === 'days' ? 'days' : everyIn.value === '1' ? 'week' : 'weeks';
    startIn.closest('label').firstChild.textContent = repeat === 'once' ? 'Date' : 'Starts';
  };
  everyIn.addEventListener('input', draw);

  body.append(...[
    kindBox, refField, cardioFields, detailField,
    h('div', { class: 'field' }, h('span', null, 'Repeats'), repBox, dayBox, everyField),
    h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'sc-time' }, 'Time', timeIn), h('label', { class: 'field', for: 'sc-start' }, 'Starts', startIn)),
    attachFields,
    h('label', { class: 'field', for: 'sc-rem' }, 'Reminder', remSel),
    !ctx.routines.length && kind === 'strength' ? h('p', { class: 'note small' }, 'Save a routine on the Strength screen first, or schedule cardio or stretching.') : null,
    occ ? h('section', { class: 'just-this' }, h('b', null, `Just ${whenText(occ)}`),
      h('div', { class: 'grid-2' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => { sheet.close(); moveSheet(occ, ctx.onDone); } }, 'Move to another day'),
        h('button', { type: 'button', class: 'btn sm', onclick: async () => { sheet.close(); await skipOcc(occ, ctx.onDone); } }, 'Skip this one'))) : null,
    h('div', { class: s ? 'grid-delete' : '' },
      s ? h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!(await confirmSheet('Delete from the schedule?', `${s.title} comes off the schedule. Workouts you've logged stay.`))) return;
        await post('schedule/delete', { id: s.id }); sheet.close(); toast('Removed from the schedule'); ctx.onDone?.();
      } }, 'Delete') : null,
      h('button', { type: 'submit', class: 'btn primary block' }, 'Save'))].filter(Boolean));
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (repeat === 'weekly' && !days.size) { toast('Pick at least one day', 'error'); return; }
    if (kind !== 'cardio' && !refSel.value) { toast(kind === 'stretch' ? 'Make a stretching routine first' : 'Choose a routine', 'error'); return; }
    try {
      await post('schedule/save', {
        id: s?.id, kind, repeat, weekdays: [...days], every_n: parseInt(everyIn.value, 10) || 1, start_date: startIn.value, time: timeIn.value || null,
        ref_id: kind === 'cardio' ? null : +refSel.value, activity: kind === 'cardio' ? activity : null, setting: kind === 'cardio' ? setSel.value || null : null,
        title: kind === 'cardio' ? activity : null, detail: kind === 'cardio' ? detailIn.value.trim() || null : null,
        warmup_id: warmSel.value ? +warmSel.value : null, cooldown_id: coolSel.value ? +coolSel.value : null,
        remind_min: remSel.value === '' ? null : +remSel.value,
      });
      sheet.close(); toast(s ? 'Schedule updated' : 'Added to the schedule'); ctx.onDone?.();
    } catch (err) { toast(err.message, 'error'); }
  });
  draw();
  const sheet = openSheet({ title: s ? 'Scheduled session' : 'Schedule a session', tall: true, body });
  return sheet;
}

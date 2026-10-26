// Habits: a daily checklist. Some habits check themselves from other data.
import { h, icon, fmt0, fmt1, todayISO, shortDate, openSheet, toast, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { pageHead, loading, dateHead, dayLabel } from '../components.js';
import { addDays } from '../tdee.js';
import { gripHandle, makeSortable } from '../sortable.js';
import { state } from '../store.js';

const SLOTS = [['morning', 'Morning'], ['day', 'During the day'], ['evening', 'Evening']];
export const KINDS = [
  ['check', 'Tick it off', 'You check it off yourself.'],
  ['minutes', 'Minutes', 'Enter minutes. Done when you reach the target.'],
  ['count', 'Count', 'Enter a number, such as glasses of water. Done at the target.'],
  ['steps', 'Steps (WHOOP)', 'Checks itself when WHOOP steps reach the target.'],
  ['sleep', 'Sleep (WHOOP)', 'Checks itself when last night’s sleep reaches the target hours.'],
  ['weigh_in', 'Weigh in', 'Checks itself when you log a weight.'],
  ['meds', 'Meds and supplements', 'Checks itself when everything on your Health list is taken.'],
  ['log_food', 'Log food', 'Checks itself when you log any food.'],
  ['mobility', 'Stretching', 'Checks itself from your stretching sessions. Set a goal in minutes, or leave it blank for any session.'],
  ['journal', 'Journal', 'Checks itself when you write a journal entry.'],
  ['water', 'Water goal', 'Checks itself when Drinks on Today reaches your water goal.'],
];
const KIND_HINT = Object.fromEntries(KINDS.map(k => [k[0], k[2]]));
const SOURCE = { whoop: 'WHOOP', weight: 'Weight log', meds: 'Health', food: 'Food log', journal: 'Journal', water: 'Drinks', stretch: 'Stretching' };
const HAS_TARGET = new Set(['minutes', 'count', 'steps', 'sleep', 'mobility']);

const fmtWater = (ml) => (state.settings?.units === 'metric' ? `${fmt1(ml / 1000).replace('.0', '')} L` : `${fmt0(ml / 29.5735)} oz`);

function subText(x) {
  if (x.kind === 'steps') return x.value != null ? `${fmt0(x.value)} of ${fmt0(x.target || 10000)}` : `Goal ${fmt0(x.target || 10000)}. Waiting for WHOOP`;
  if (x.kind === 'sleep') return x.value != null ? `Last night ${Math.floor(x.value)}h ${String(Math.round((x.value % 1) * 60)).padStart(2, '0')}m` : `Goal ${fmt1(x.target || 7).replace('.0', '')} h. Waiting for WHOOP`;
  if (x.kind === 'minutes') return x.value != null ? `${fmt0(x.value)} of ${fmt0(x.target)} min` : `${fmt0(x.target || 0)} min goal`;
  if (x.kind === 'count') return x.value != null ? `${fmt0(x.value)} of ${fmt0(x.target)}` : `Goal ${fmt0(x.target || 0)}`;
  if (x.kind === 'meds') return x.due != null ? (x.due ? `${fmt0(x.value)} of ${fmt0(x.due)} doses taken` : 'Nothing due today') : 'Add your list in Health';
  if (x.kind === 'water') return x.value ? `${fmtWater(x.value)} so far` : 'Log water from Today';
  if (x.kind === 'mobility') return x.value ? `${fmt0(x.value)}${x.target ? ` of ${fmt0(x.target)}` : ''} min stretched` : x.target ? `${fmt0(x.target)} min goal. Start a routine from Train > Stretch` : 'Any stretching session counts';
  if (x.auto) return x.done ? `From your ${SOURCE[x.source]?.toLowerCase() || 'log'}` : `Checks itself from your ${SOURCE[x.source]?.toLowerCase() || 'log'}`;
  return x.done ? 'Done' : 'Not yet';
}

/** One checklist row. `onChange` runs after a save. */
export function habitRow(x, date, onChange) {
  const id = `hb-${x.id}-${date}`;
  const autoDone = x.auto && x.done && x.kind !== 'minutes' && x.kind !== 'count';
  const cb = h('input', { type: 'checkbox', id, checked: x.done, disabled: autoDone, onchange: async (e) => {
    try { await post('habits/log', { habit_id: x.id, date, done: e.target.checked, value: x.kind === 'minutes' || x.kind === 'count' ? x.value : null }); onChange?.(); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
  } });
  const valueBtn = (x.kind === 'minutes' || x.kind === 'count')
    ? h('button', { class: 'btn sm', type: 'button', 'aria-label': `Enter ${x.kind === 'minutes' ? 'minutes' : 'amount'} for ${x.name}`, onclick: (e) => { e.preventDefault(); enterValue(x, date, onChange); } }, x.value != null ? fmt0(x.value) : '+')
    : null;
  return h('div', { class: 'check-row habit-row' + (x.done ? ' done' : '') },
    cb,
    h('label', { class: 'main', for: id },
      h('span', { class: 'title' }, x.name),
      h('span', { class: 'small muted' }, subText(x))),
    x.auto && x.source ? h('span', { class: 'badge' + (x.source === 'whoop' ? ' dark' : '') }, x.source === 'whoop' ? 'WHOOP' : 'Auto') : null,
    valueBtn,
    x.streak ? h('span', { class: 'streak', title: `${x.streak}-day streak`, 'aria-label': `${x.streak}-day streak` }, `${x.streak}d`) : null);
}

function enterValue(x, date, onChange) {
  const input = h('input', { class: 'input big', id: 'hv-in', inputmode: 'numeric', value: x.value != null ? fmt0(x.value) : '' });
  const unit = x.kind === 'minutes' ? 'min' : '';
  const s = openSheet({
    title: x.name,
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const v = parseFloat(input.value);
      try {
        await post('habits/log', { habit_id: x.id, date, value: Number.isNaN(v) ? null : v, done: !Number.isNaN(v) && x.target ? v >= x.target : !Number.isNaN(v) && v > 0 });
        s.close(); onChange?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'hv-in' }, `${x.kind === 'minutes' ? 'Minutes' : 'Amount'}${x.target ? ` (goal ${fmt0(x.target)}${unit ? ' ' + unit : ''})` : ''}`, input),
      h('div', { class: 'pills' }, (x.kind === 'minutes' ? [5, 10, 15, 30] : [1, 2]).map(n => h('button', { class: 'pill', type: 'button', onclick: () => { input.value = String((parseFloat(input.value) || 0) + n); } }, `+${n}`))),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save')),
  });
  setTimeout(() => input.focus(), 40);
}

export async function render(root, params) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? params[0] : todayISO();
  root.replaceChildren(loading());
  const data = await get('habits', { date, days: 63 });
  const refresh = () => render(root, [date]);
  const list = data.habits;
  const done = list.filter(x => x.done).length;
  const past = data.history.slice(0, -1).slice(-30);
  const rate = past.reduce((a, d) => a + (d.total ? d.done / d.total : 0), 0) / (past.filter(d => d.total).length || 1);

  // Heat map: 5 weeks, Sunday to Saturday, ending with the week of `date`.
  const end = new Date(date + 'T12:00:00');
  const lastSat = addDays(date, 6 - end.getDay());
  const start = addDays(lastSat, -34);
  const byDate = Object.fromEntries(data.history.map(d => [d.date, d]));
  const cells = [];
  for (let i = 0; i < 35; i++) {
    const d = addDays(start, i);
    const r = byDate[d];
    const pct = r && r.total ? r.done / r.total : null;
    const lvl = d > date || pct == null ? -1 : pct >= 0.99 ? 3 : pct >= 0.67 ? 2 : pct > 0 ? 1 : 0;
    cells.push(h('div', { class: `heat l${lvl}` + (d === date ? ' today' : ''), title: r && d <= date ? `${shortDate(d)}: ${r.done} of ${r.total}` : '' }));
  }

  const groups = SLOTS.map(([slot, label]) => {
    const rows = list.filter(x => x.slot === slot);
    if (!rows.length) return null;
    return h('section', { class: 'card habit-group', 'aria-label': label },
      h('h2', { class: 'list-label', style: { padding: 0 } }, label),
      h('div', { class: 'list' }, rows.map(x => habitRow(x, date, refresh))));
  });

  root.replaceChildren(
    dateHead({ eyebrow: dayLabel(date), title: 'Habits', prev: `#/habits/${addDays(date, -1)}`, next: date < todayISO() ? `#/habits/${addDays(date, 1)}` : null }),
    h('div', { class: 'row' },
      h('div', { class: 'grow-2 stack' },
        h('section', { class: 'card', 'aria-label': 'Progress' },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '8px' } },
            h('span', { class: 'num', style: { fontSize: '48px', color: 'var(--green)' } }, done, h('span', { class: 'unit', style: { fontSize: '22px' } }, ` of ${list.length} ${date === todayISO() ? 'today' : 'that day'}`)),
            h('span', { class: 'small muted' }, `${fmt0(rate * 100)}% over 30 days`)),
          h('div', { class: 'heatmap', role: 'img', 'aria-label': 'Share of habits done each day for the last 5 weeks' },
            ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => h('span', { class: 'tiny muted', 'aria-hidden': 'true' }, d)), ...cells),
          h('div', { class: 'legend' }, h('span', null, 'Fewer'), ...[0, 1, 2, 3].map(l => h('i', { class: `heat l${l}`, style: { width: '14px', height: '14px' } })), h('span', null, 'All done'))),
        h('div', { class: 'grid-2' },
          h('button', { class: 'btn', onclick: () => manageHabits(data.all, refresh) }, 'Edit habits'),
          h('button', { class: 'btn', onclick: () => editHabit(null, refresh) }, icon('plus', 18), 'Add a habit'))),
      h('div', { class: 'grow-3 stack' },
        list.length ? groups : h('section', { class: 'card' }, h('p', { class: 'note' }, 'No habits yet. Add one to start your daily checklist.')))));
}

function manageHabits(all, onDone) {
  let order = [...all];
  openSheet({
    title: 'Edit habits',
    tall: true,
    onClose: onDone,
    body: (sheet) => {
      const list = h('div', { class: 'list' });
      const reload = async () => { order = (await get('habits', { days: 7 })).all; draw(); };
      const draw = () => list.replaceChildren(...order.map((x) => h('div', { class: 'list-row sort-row', 'data-key': String(x.id), 'data-label': x.name },
        gripHandle(x.name),
        h('button', { class: 'main row-btn', onclick: () => editHabit(x, reload) },
          h('span', { class: 'title' }, x.name),
          h('span', { class: 'small muted' }, [SLOTS.find(s => s[0] === x.slot)?.[1], KINDS.find(k => k[0] === x.kind)?.[1], x.active ? null : 'paused'].filter(Boolean).join(', '))),
        h('button', { class: 'icon-btn', 'aria-label': `Edit ${x.name}`, onclick: () => editHabit(x, reload) }, icon('edit', 18)))));
      makeSortable(list, { onChange: async (keys) => {
        order = keys.map(k => order.find(o => String(o.id) === k));
        try { await post('habits/order', { ids: keys.map(Number) }); } catch (e) { toast(e.message, 'error'); }
      } });
      draw();
      sheet.body.append(h('p', { class: 'note small' }, 'Tap a habit to change it. Drag the handle to change the order; habits show grouped by time of day.'), list,
        h('button', { class: 'btn primary block', onclick: () => editHabit(null, reload) }, 'Add a habit'));
    },
  });
}

export function editHabit(x, onSaved) {
  const kindSel = h('select', { class: 'input', id: 'he-kind' }, KINDS.map(([v, l]) => h('option', { value: v, selected: v === (x?.kind || 'check') }, l)));
  const slotSel = h('select', { class: 'input', id: 'he-slot' }, SLOTS.map(([v, l]) => h('option', { value: v, selected: v === (x?.slot || 'day') }, l)));
  const target = h('input', { class: 'input', id: 'he-target', inputmode: 'decimal', value: x?.target ?? '' });
  const targetLabel = h('span');
  const targetField = h('label', { class: 'field', for: 'he-target' }, targetLabel, target);
  const hint = h('p', { class: 'note small' });
  const sync = () => {
    const k = kindSel.value;
    targetField.hidden = !HAS_TARGET.has(k);
    targetLabel.textContent = { minutes: 'Goal (minutes)', count: 'Goal', steps: 'Goal (steps)', sleep: 'Goal (hours)' }[k] || 'Goal';
    if (!target.value && HAS_TARGET.has(k)) target.placeholder = { minutes: '30', count: '8', steps: '10000', sleep: '7' }[k];
    hint.textContent = KIND_HINT[k];
  };
  kindSel.addEventListener('change', sync);
  const s = openSheet({
    title: x ? 'Edit habit' : 'Add a habit',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const k = kindSel.value;
      const t = parseFloat(target.value || target.placeholder);
      try {
        await post('habits/save', { id: x?.id, name: f.querySelector('#he-name').value, slot: slotSel.value, kind: k, target: HAS_TARGET.has(k) && !Number.isNaN(t) ? t : null, active: f.querySelector('#he-act').checked });
        s.close(); toast('Habit saved'); onSaved?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'he-name' }, 'Name', h('input', { id: 'he-name', required: true, maxlength: 80, value: x?.name || '', placeholder: 'Floss' })),
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'he-kind' }, 'Type', kindSel), h('label', { class: 'field', for: 'he-slot' }, 'Time of day', slotSel)),
      hint, targetField,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'he-act', checked: x ? x.active : true }), 'On my daily checklist'),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save habit'),
      x ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet(`Delete ${x.name}?`, 'This deletes the habit and its history. To keep the history, untick "On my daily checklist" instead.'))) return;
        await post('habits/delete', { id: x.id }); s.close(); onSaved?.();
      } }, 'Delete habit') : null),
  });
  sync();
}

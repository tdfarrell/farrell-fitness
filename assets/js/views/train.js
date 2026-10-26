import { h, icon, fmt0, fmt1, todayISO, relDay, shortDate, openSheet, toast, confirmSheet, debounce, svgRing } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, wUnit, liftDisplay, fromDisplayW, toDisplayW, imperial } from '../store.js';
import { pageHead, loading, foldCard } from '../components.js';
import { chart, dateTicks } from '../charts.js';
import { trainSwitch, renderCardio, renderCardioForm, renderProgress } from './cardio.js';
import { gripHandle, makeSortable } from '../sortable.js';
import { ring, unlockAudio, scheduleRestPush, cancelRestPush, playTone, alarmSettings } from '../restalarm.js';
import { fmtHold, parseHold, newHold, holdNow, advanceHold, stopHold, pauseHold, resumeHold, skipLead, extendHold } from '../hold.js';

const ACTIVE_KEY = 'ff_active_workout_v1';
const histCache = new Map();
let exercisesCache = null;

const readActive = () => { try { return JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null'); } catch { return null; } };
const writeActive = (w) => { try { if (w) localStorage.setItem(ACTIVE_KEY, JSON.stringify(w)); else localStorage.removeItem(ACTIVE_KEY); } catch {} };
const e1rm = (kg, reps) => (kg && reps ? kg * (1 + Math.min(reps, 12) / 30) : null);

async function exercises(force = false) {
  if (!exercisesCache || force) exercisesCache = (await get('exercises')).exercises;
  return exercisesCache;
}
async function history(id) {
  if (!histCache.has(id)) histCache.set(id, get('exercises/history', { id }).then(r => r.history).catch(() => []));
  return histCache.get(id);
}

export async function render(root, params) {
  await loadSummary();
  const [a, b, c] = params;
  if (a === 'cardio') {
    if (b === 'new') return renderCardioForm(root);
    if (b === 'whoop' && c) return renderCardioForm(root, { whoopId: decodeURIComponent(c) });
    if (b && /^\d+$/.test(b)) return renderCardioForm(root, { id: +b });
    return renderCardio(root);
  }
  if (a === 'progress') return renderProgress(root);
  if (a === 'stretch') return (await import('./stretch.js')).render(root, params.slice(1));
  if (a === 'schedule') return (await import('./schedule.js')).render(root);
  if (a === 'new') { const q = new URLSearchParams(location.hash.split('?')[1] || ''); return startWorkout(root, q.get('routine'), { noWarm: q.has('nowarm'), cooldown: q.get('cooldown') }); }
  if (a === 'active') return renderActive(root);
  if (a === 'exercise' && b) return renderExercise(root, +b);
  if (a && /^\d+$/.test(a)) return renderSaved(root, +a);
  if (a === 'strength') return renderList(root);
  return (await import('./trainhome.js')).render(root);
}

/* ---------- list ---------- */

async function renderList(root) {
  const [routinesRes, wk, exs] = await Promise.all([get('routines'), get('workouts', { from: shiftDate(-90) }), exercises()]);
  const exName = Object.fromEntries(exs.map(e => [e.id, e.name]));
  const active = readActive();
  // Cardio from WHOOP lives on the Cardio tab; here WHOOP only adds strain to lifting days.
  const items = wk.workouts.map(w => ({ kind: 'lift', date: w.date, w })).sort((p, q) => (p.date < q.date ? 1 : -1));
  const strainByDate = {};
  wk.whoop.forEach(x => { if (x.strength) strainByDate[x.date] = x.strain; });

  root.replaceChildren(
    pageHead('Training', 'Strength', [h('a', { class: 'btn sm primary', href: '#/train/new' }, 'Empty workout')]),
    h('div', { class: 'stack' },
      trainSwitch('strength'),
      active ? h('a', { class: 'linkcard', href: '#/train/active' },
        h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          h('span', { style: { fontWeight: 600 } }, `Resume ${active.name}`),
          h('span', { class: 'small muted' }, `Started ${new Date(active.started_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)),
        icon('right', 20)) : null,
      h('div', { class: 'row' },
        h('section', { class: 'card grow-2', 'aria-label': 'Routines' },
          h('div', { class: 'card-head' }, h('h2', null, 'Routines'), h('button', { class: 'btn sm ghost', onclick: () => editRoutine(null, exs, () => renderList(root)) }, 'New routine')),
          routinesRes.routines.length ? h('div', { class: 'list' }, routinesRes.routines.map(r => h('div', { class: 'list-row' },
            h('div', { class: 'main' }, h('span', { class: 'title' }, r.name), h('span', { class: 'small muted' }, r.exercise_ids.map(id => exName[id]).filter(Boolean).join(', '))),
            h('button', { class: 'btn sm ghost', 'aria-label': `Edit ${r.name}`, onclick: () => editRoutine(r, exs, () => renderList(root)) }, 'Edit'),
            h('a', { class: 'btn sm', href: `#/train/new?routine=${r.id}` }, 'Start'))))
            : h('p', { class: 'note' }, 'Save the exercises you repeat as a routine to start them in one tap.')),
        h('div', { class: 'grow-3 stack' }, foldCard({ key: 'strength-history', title: 'Last 90 days', label: 'History', summary: `${items.length} session${items.length === 1 ? '' : 's'}` },
          items.length ? h('div', { class: 'list' }, items.map(it =>
            h('a', { class: 'list-row', href: `#/train/${it.w.id}`, style: { textDecoration: 'none', color: 'inherit' } },
              h('div', { class: 'main' }, h('span', { class: 'title' }, it.w.name),
                h('span', { class: 'small muted' }, `${relDay(it.w.date)}${it.w.duration_min ? `, ${it.w.duration_min} min` : ''}, ${it.w.set_count} sets, ${fmt0(toDisplayW(it.w.volume_kg))} ${wUnit()} volume`)),
              strainByDate[it.date] != null ? h('span', { class: 'small muted' }, `Strain ${fmt1(strainByDate[it.date])}`) : null)))
            : h('p', { class: 'note' }, 'No lifting sessions yet. Start a routine or an empty workout.')))),
      foldCard({ key: 'strength-exercises', title: 'Exercises', summary: String(exs.length), open: false,
        action: h('button', { class: 'btn sm ghost', onclick: () => editExercise(null, () => { exercisesCache = null; renderList(root); }) }, 'New exercise') },
        h('div', { class: 'pills' }, exs.map(e => h('a', { class: 'pill', href: `#/train/exercise/${e.id}`, style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' } }, e.name))))));
}

function shiftDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Cable', 'Resistance band', 'Bodyweight', 'Smith machine', 'EZ bar', 'Trap bar', 'Other'];
export const KINDS = [['lift', 'Lift', 'Counts toward lifting volume'], ['plyo', 'Plyometric', 'Jumps, throws, swings. Not in volume'],
  ['core', 'Core', 'Planks, crunches, leg raises. Not in volume'], ['carry', 'Carry', 'Farmer, suitcase, yoke. Not in volume'],
  ['olympic', 'Olympic', 'Cleans, snatches, jerks. Counts toward volume'], ['mobility', 'Mobility', 'Drills and stretches. Not in volume'], ['other', 'Other', 'Not in volume']];
export const KIND_NAME = Object.fromEntries(KINDS.map(([k, n]) => [k, n]));
const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full body', 'Other'];
/** Equipment that starts from an empty bar, for warm-up ramps. */
const BAR_KG = { Barbell: 20.4, 'Smith machine': 0, 'EZ bar': 9, 'Trap bar': 25 };

function chipGroup(options, selected, { multi = false, label, onChange }) {
  const box = h('div', { class: 'chips', role: multi ? 'group' : 'radiogroup', 'aria-label': label });
  const draw = () => box.replaceChildren(...options.map(([k, l]) => h('button', {
    type: 'button', class: 'chip', [multi ? 'aria-pressed' : 'aria-checked']: String(multi ? selected.has(k) : selected === k), role: multi ? null : 'radio',
    onclick: () => { if (multi) { selected.has(k) ? selected.delete(k) : selected.add(k); } else selected = k; draw(); onChange?.(multi ? selected : k); },
  }, l)));
  draw();
  return box;
}

const HOLDS = [20, 30, 45, 60, 90];
export const isTimed = (ex) => ex?.measure === 'time';
/** "0:45" or "0:52 at +25 lb". */
const holdText = (s, short = false) => `${fmtHold(s.duration_s) || '-'}${s.weight_kg ? ` at +${liftDisplay(s.weight_kg)}${short ? '' : ` ${wUnit()}`}` : ''}`;

function editExercise(ex, onDone) {
  let equipment = ex?.equipment || null, kind = ex?.kind || 'lift', measure = ex?.measure || 'reps', perSide = !!ex?.per_side;
  let holdChoice = ex?.hold_s == null ? '' : HOLDS.includes(ex.hold_s) ? String(ex.hold_s) : 'other';
  const muscles = ex?.muscle && !MUSCLES.includes(ex.muscle) ? [ex.muscle, ...MUSCLES] : MUSCLES;
  const kindList = h('div', { class: 'list', role: 'radiogroup', 'aria-label': 'Type' }, KINDS.map(([k, n, d]) => h('label', { class: 'set-row-line' },
    h('input', { type: 'radio', name: 'ex-kind', class: 'radio', checked: kind === k, onchange: () => { kind = k; } }),
    h('span', { class: 'main' }, h('span', { class: 'title' }, n), h('span', { class: 'small muted' }, d)))));
  // Reps or time. Timed exercises get a usual hold (it fills new sets) and can be held on each side.
  const otherIn = h('input', { class: 'input', id: 'ex-hold', inputmode: 'numeric', placeholder: 'Like 1:15', 'aria-label': 'Usual hold, minutes and seconds',
    value: holdChoice === 'other' ? fmtHold(ex.hold_s) : '', hidden: holdChoice !== 'other' });
  const timeBox = h('div', { class: 'stack', style: { gap: '12px' }, hidden: measure !== 'time' },
    h('p', { class: 'small muted', style: { margin: 0 } }, 'Each set is a timed hold. The workout log gets a timer for it.'),
    h('div', { class: 'field' }, h('span', null, 'Usual hold'),
      chipGroup([...HOLDS.map(x => [String(x), fmtHold(x)]), ['other', 'Other']], holdChoice, { label: 'Usual hold', onChange: (v) => { holdChoice = v; otherIn.hidden = v !== 'other'; if (v === 'other') otherIn.focus(); } }),
      otherIn),
    h('label', { class: 'set-row-line' },
      h('span', { class: 'main' }, h('span', { class: 'title' }, 'Each side'), h('span', { class: 'small muted' }, 'Side plank, single-leg holds. Times left, then right')),
      h('input', { type: 'checkbox', class: 'radio', checked: perSide, onchange: (e) => { perSide = e.target.checked; } })));
  const seg = h('div', { class: 'segmented big', role: 'radiogroup', 'aria-label': 'Track sets by' });
  const drawSeg = () => seg.replaceChildren(...[['reps', 'Reps'], ['time', 'Time']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(measure === k),
    onclick: () => { measure = k; drawSeg(); timeBox.hidden = measure !== 'time'; } }, l)));
  drawSeg();
  const s = openSheet({
    title: ex ? 'Edit exercise' : 'New exercise',
    tall: true,
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const hold_s = measure !== 'time' ? null : holdChoice === 'other' ? parseHold(otherIn.value) : holdChoice ? +holdChoice : null;
      if (measure === 'time' && holdChoice === 'other' && otherIn.value.trim() && !hold_s) { toast('Enter the hold like 1:15', 'error'); otherIn.focus(); return; }
      const r = await post('exercises/save', { id: ex?.id, name: f.querySelector('#ex-name').value, muscle: f.querySelector('#ex-m').value, equipment, kind, measure, hold_s, per_side: measure === 'time' && perSide });
      s.close(); toast('Exercise saved'); onDone?.(r.exercise);
    } },
      h('label', { class: 'field', for: 'ex-name' }, 'Name', h('input', { id: 'ex-name', required: true, value: ex?.name || '' })),
      h('label', { class: 'field', for: 'ex-m' }, 'Muscle group',
        h('select', { id: 'ex-m' }, h('option', { value: '' }, 'Choose'), muscles.map(m => h('option', { value: m, selected: ex?.muscle === m }, m)))),
      h('div', { class: 'field' }, h('span', null, 'Equipment'),
        chipGroup(EQUIPMENT.map(e => [e, e]), equipment, { label: 'Equipment', onChange: (v) => { equipment = v; } })),
      h('div', { class: 'field' }, h('span', null, 'Type'), kindList),
      h('div', { class: 'measure-box stack' }, h('span', { class: 'field-label' }, 'Track sets by'), seg, timeBox),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save exercise'),
      ex ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet('Delete exercise?', 'It disappears from pickers. Past workouts keep it.'))) return;
        await post('exercises/delete', { id: ex.id }); s.close(); onDone?.(null);
      } }, 'Delete exercise') : null),
  });
}

/**
 * Warm-up ramp toward a working weight (display units): the empty bar for 10, then 40%, 60% and 80%
 * for 5, 3 and 2, rounded to 5 lb or 2.5 kg. Steps that would be no heavier than the one before are dropped.
 */
export function warmupRamp(work, equipment) {
  const lb = imperial();
  const step = lb ? 5 : 2.5;
  const round = (v) => Math.round(v / step) * step;
  const barKg = BAR_KG[equipment];
  const bar = barKg ? (lb ? { 'Barbell': 45, 'EZ bar': 20, 'Trap bar': 55 }[equipment] : { 'Barbell': 20, 'EZ bar': 10, 'Trap bar': 25 }[equipment]) : 0;
  const out = [];
  if (!work || work <= 0) return out;
  if (bar && work > bar * 1.25) out.push({ w: bar, r: 10 });
  for (const [pct, reps] of [[0.4, 5], [0.6, 3], [0.8, 2]]) {
    const w = round(work * pct);
    const prev = out.length ? out[out.length - 1].w : 0;
    if (w > prev && w < work && w > bar) out.push({ w, r: reps });
  }
  return out;
}

function editRoutine(r, exs, onDone) {
  const byId = Object.fromEntries(exs.map(e => [e.id, e]));
  // Each exercise with its planned sets in display units. No sets planned means the workout fills them from last time.
  const items = (r?.exercise_ids || []).map((id, i) => ({
    id, open: false,
    sets: (r?.plan?.[i]?.sets || []).map(s => ({ w: s.weight_kg == null ? '' : liftDisplay(s.weight_kg), r: s.reps == null ? '' : String(s.reps), t: fmtHold(s.duration_s), warmup: !!s.warmup })),
  }));
  const timed = (it) => isTimed(byId[it.id]);
  openSheet({
    title: r ? 'Edit routine' : 'New routine',
    tall: true,
    body: (sheet) => {
      const nameIn = h('input', { id: 'rt-name', value: r?.name || '', required: true });
      const list = h('div', { class: 'stack routine-items', style: { gap: '10px' } });
      const workOf = (it) => Math.max(0, ...it.sets.filter(s => !s.warmup).map(s => parseFloat(s.w) || 0));
      const summary = (it) => {
        const work = it.sets.filter(s => !s.warmup);
        if (!work.length) return 'Sets from last time';
        if (timed(it)) {
          const ts = [...new Set(work.map(s => s.t || '-'))], w = workOf(it);
          return `${work.length} × ${ts.length === 1 ? ts[0] : ts.join('/')}${w ? ` at +${w} ${wUnit()}` : ''}${byId[it.id]?.per_side ? ' each side' : ''}`;
        }
        const reps = [...new Set(work.map(s => s.r || '-'))];
        const w = workOf(it);
        const warm = it.sets.length - work.length;
        return `${work.length} × ${reps.length === 1 ? reps[0] : reps.join('/')}${w ? ` at ${w}` : ''}${warm ? `, ${warm} warm-up${warm === 1 ? '' : 's'}` : ''}`;
      };
      const addRamp = (it) => {
        const ex = byId[it.id];
        const ramp = warmupRamp(workOf(it), ex?.equipment);
        if (!ramp.length) { toast('Set a working weight first', 'error'); return; }
        it.sets = [...ramp.map(x => ({ w: String(x.w), r: String(x.r), warmup: true })), ...it.sets.filter(s => !s.warmup)];
        it.open = true; draw();
      };
      // Rows carry their position as the key, so duplicates of one exercise reorder correctly.
      const draw = () => list.replaceChildren(...items.map((it, i) => {
        const ex = byId[it.id];
        const name = ex?.name || 'Exercise';
        const head = h('div', { class: 'ritem-head' },
          gripHandle(name),
          h('button', { class: 'ritem-toggle', 'aria-expanded': String(it.open), onclick: () => { it.open = !it.open; draw(); } },
            h('span', { class: 'title' }, name),
            h('span', { class: 'small muted' }, summary(it))),
          ex?.equipment ? h('span', { class: 'tag primary' }, ex.equipment) : null,
          h('button', { class: 'icon-btn', 'aria-label': `Remove ${name}`, onclick: () => { items.splice(i, 1); draw(); } }, icon('close', 18)));
        const body = [];
        if (it.open && timed(it)) {
          let n = 0;
          body.push(h('div', { class: 'plan-grid head' }, h('span', null, 'Set'), h('span', null, 'Hold'), h('span', null, `Added ${wUnit()}`), h('span')));
          it.sets.forEach((s, si) => {
            const label = String(++n);
            const tIn = h('input', { inputmode: 'numeric', value: s.t, placeholder: fmtHold(ex?.hold_s) || '0:45', 'aria-label': `Set ${label} hold`, oninput: (e) => { s.t = e.target.value; },
              onblur: (e) => { const v = parseHold(e.target.value); if (v) { s.t = fmtHold(v); e.target.value = s.t; } } });
            const wIn = h('input', { inputmode: 'decimal', value: s.w, placeholder: 'None', 'aria-label': `Set ${label} added weight in ${wUnit()}`, oninput: (e) => { s.w = e.target.value; } });
            body.push(h('div', { class: 'plan-grid' }, h('span', { class: 'set-n' }, label), tIn, wIn,
              h('button', { class: 'icon-btn', 'aria-label': `Remove set ${label}`, onclick: () => { it.sets.splice(si, 1); draw(); } }, icon('close', 16))));
          });
          body.push(h('span', { class: 'tiny muted' }, 'Type 45 for 0:45, or 130 for 1:30.'));
          body.push(h('button', { class: 'btn sm dashed', onclick: () => { const last = it.sets[it.sets.length - 1]; it.sets.push({ t: last?.t || fmtHold(ex?.hold_s), w: last?.w || '', r: '', warmup: false }); draw(); } }, 'Add set'));
        } else if (it.open) {
          let n = 0;
          body.push(h('div', { class: 'plan-grid head' }, h('span', null, 'Set'), h('span', null, wUnit()), h('span', null, 'Reps'), h('span')));
          it.sets.forEach((s, si) => {
            const label = s.warmup ? 'W' : String(++n);
            const wIn = h('input', { inputmode: 'decimal', value: s.w, 'aria-label': `${s.warmup ? 'Warm-up' : `Set ${label}`} weight in ${wUnit()}`, oninput: (e) => { s.w = e.target.value; } });
            const rIn = h('input', { inputmode: 'numeric', value: s.r, 'aria-label': `${s.warmup ? 'Warm-up' : `Set ${label}`} reps`, oninput: (e) => { s.r = e.target.value; } });
            body.push(h('div', { class: 'plan-grid' + (s.warmup ? ' warm' : '') },
              h('span', { class: 'set-n' }, label), wIn, rIn,
              h('button', { class: 'icon-btn', 'aria-label': `Remove ${s.warmup ? 'warm-up' : `set ${label}`}`, onclick: () => { it.sets.splice(si, 1); draw(); } }, icon('close', 16))));
          });
          body.push(h('div', { class: 'grid-2' },
            h('button', { class: 'btn sm dashed', onclick: () => { const last = it.sets.filter(x => !x.warmup).pop(); it.sets.push({ w: last?.w || '', r: last?.r || '', warmup: false }); draw(); } }, 'Add set'),
            h('button', { class: 'btn sm dashed', onclick: () => { const firstWork = it.sets.findIndex(x => !x.warmup); it.sets.splice(firstWork < 0 ? it.sets.length : firstWork, 0, { w: '', r: '', warmup: true }); draw(); } }, 'Add warm-up')));
          if (workOf(it) && !it.sets.some(x => x.warmup)) body.push(h('button', { class: 'btn sm soft', onclick: () => addRamp(it) }, icon('ramp', 16), `Add warm-ups from ${workOf(it)} ${wUnit()}`));
          else if (workOf(it)) body.push(h('span', { class: 'tiny muted' }, `Warm-ups ramp ${BAR_KG[ex?.equipment] ? 'from the bar: ' : ''}40%, 60%, 80% of ${workOf(it)}, rounded to ${imperial() ? '5 lb' : '2.5 kg'}.`));
        } else if (!timed(it) && workOf(it) && !it.sets.some(x => x.warmup)) {
          body.push(h('button', { class: 'btn sm soft', onclick: () => addRamp(it) }, icon('ramp', 16), `Add warm-ups from ${workOf(it)} ${wUnit()}`));
        }
        return h('section', { class: 'ritem sort-row', 'data-key': String(i), 'data-label': name }, head, ...body);
      }));
      makeSortable(list, { onChange: (keys) => { const next = keys.map(k => items[+k]); items.splice(0, items.length, ...next); draw(); } });
      draw();
      sheet.body.append(
        h('label', { class: 'field', for: 'rt-name' }, 'Name', nameIn),
        h('p', { class: 'note small' }, 'Tap an exercise to plan its sets and warm-ups. Drag the handle to change the order.'),
        list,
        h('button', { class: 'btn block', onclick: () => pickExercise((ex) => { items.push({ id: ex.id, open: false, sets: [] }); draw(); }) }, 'Add exercise'),
        h('button', { class: 'btn primary block', onclick: async () => {
          if (!nameIn.value.trim()) { toast('Name the routine', 'error'); return; }
          const kgOf = (v) => (v === '' || v == null ? null : fromDisplayW(String(v).replace(',', '.')));
          const plan = items.some(it => it.sets.length) ? items.map(it => ({ sets: timed(it)
            ? it.sets.filter(s => parseHold(s.t) || s.w !== '').map(s => ({ duration_s: parseHold(s.t), weight_kg: kgOf(s.w), reps: null, warmup: false }))
            : it.sets.filter(s => s.w !== '' || s.r !== '').map(s => ({ weight_kg: kgOf(s.w), reps: s.r === '' ? null : parseInt(s.r, 10), warmup: s.warmup })) })) : null;
          await post('routines/save', { id: r?.id, name: nameIn.value, exercise_ids: items.map(it => it.id), plan });
          sheet.close(); toast('Routine saved'); onDone?.();
        } }, 'Save routine'),
        r ? h('button', { class: 'btn block danger', onclick: async () => {
          if (!(await confirmSheet('Delete routine?', `Delete ${r.name}? Past workouts aren't affected.`))) return;
          await post('routines/delete', { id: r.id }); sheet.close(); onDone?.();
        } }, 'Delete routine') : null);
    },
  });
}

// Picker filters are remembered for the session, so adding several exercises keeps them.
const pickFilter = { equip: new Set(), kind: 'all' };
function pickExercise(onPick) {
  openSheet({
    title: 'Add exercise',
    tall: true,
    body: async (sheet) => {
      const all = await exercises();
      const q = h('input', { type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises' });
      const list = h('div', { class: 'list' });
      const count = h('span', { class: 'small muted' });
      const clear = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { pickFilter.equip.clear(); pickFilter.kind = 'all'; drawFilters(); draw(); } }, 'Clear filters');
      const filters = h('div', { class: 'stack', style: { gap: '10px' } });
      const drawFilters = () => filters.replaceChildren(
        h('div', { class: 'field' }, h('span', { class: 'chip-label' }, 'Equipment'),
          chipGroup(EQUIPMENT.map(e => [e, e]), pickFilter.equip, { multi: true, label: 'Equipment', onChange: draw })),
        h('div', { class: 'field' }, h('span', { class: 'chip-label' }, 'Type'),
          chipGroup([['all', 'All'], ...KINDS.map(([k, n]) => [k, n])], pickFilter.kind, { label: 'Type', onChange: (v) => { pickFilter.kind = v; draw(); } })));
      const lastText = (e) => (!e.last ? 'Never done' : isTimed(e)
        ? `Last: ${fmtHold(e.last.duration_s) || '-'}${e.last.weight_kg ? ` at +${liftDisplay(e.last.weight_kg)}` : ''}, ${shortDate(e.last.date).split(', ')[1]}`
        : `Last: ${e.last.weight_kg ? `${liftDisplay(e.last.weight_kg)} × ` : ''}${e.last.reps ?? '-'}${e.last.weight_kg ? '' : ' reps'}, ${shortDate(e.last.date).split(', ')[1]}`);
      function draw() {
        const t = q.value.trim().toLowerCase();
        const hits = all.filter(e => (!t || e.name.toLowerCase().includes(t) || (e.muscle || '').toLowerCase().includes(t))
          && (!pickFilter.equip.size || pickFilter.equip.has(e.equipment || 'Other'))
          && (pickFilter.kind === 'all' || (e.kind || 'lift') === pickFilter.kind));
        const filtered = pickFilter.equip.size || pickFilter.kind !== 'all';
        count.textContent = `${hits.length} exercise${hits.length === 1 ? '' : 's'}${t ? ` match "${q.value.trim()}"` : ''}${pickFilter.equip.size ? `, ${[...pickFilter.equip].join(', ')}` : ''}${pickFilter.kind !== 'all' ? `, ${KIND_NAME[pickFilter.kind]}` : ''}`;
        clear.hidden = !filtered;
        list.replaceChildren(...[...hits.map(e => h('button', { class: 'list-row', onclick: () => { sheet.close(); onPick(e); } },
          h('div', { class: 'main' }, h('span', { class: 'title' }, e.name),
            h('span', { class: 'tag-row' },
              e.equipment ? h('span', { class: 'tag primary' }, e.equipment) : null,
              e.muscle ? h('span', { class: 'tag' }, e.muscle) : null,
              e.kind && e.kind !== 'lift' ? h('span', { class: 'tag' }, KIND_NAME[e.kind]) : null,
              h('span', { class: 'tiny muted' }, lastText(e)))),
          h('span', { class: 'add-ic', 'aria-hidden': 'true' }, icon('plus', 20)))),
          hits.length ? null : h('p', { class: 'note' }, 'Nothing matches. Clear the filters or create the exercise.'),
          h('button', { class: 'btn block dashed', style: { marginTop: '8px' }, onclick: () => { sheet.close(); editExercise(null, async (ex) => { await exercises(true); if (ex) onPick(ex); }); } }, 'New exercise')].filter(Boolean));
      }
      q.addEventListener('input', draw);
      drawFilters();
      sheet.body.append(h('label', { class: 'search', style: { flex: 'none' } }, icon('search'), q), filters, h('div', { class: 'card-head', style: { alignItems: 'center' } }, count, clear), list);
      draw();
      q.focus();
    },
  });
}

/* ---------- active workout ---------- */

/** Stretching routines attached to a strength routine (or a cardio activity) as a warm-up or cool-down. */
export async function attachedStretch(match, when) {
  try {
    const st = await get('stretch');
    return st.routines.find(r => r.attach.some(a => a.when === when && (match.routine ? a.type === 'routine' && a.id === +match.routine : a.type === 'cardio' && a.activity === match.activity))) || null;
  } catch { return null; }
}

/** A workout entry: what the log needs to know about the exercise, and its sets. */
function entryFor(def, sets, weighted = false) {
  return { exercise_id: def.id, name: def.name, measure: def.measure || 'reps', per_side: !!def.per_side, hold_s: def.hold_s ?? null, kind: def.kind || 'lift', weighted: !!weighted, sets };
}
const blankSet = (o = {}) => ({ weight: '', reps: '', time: '', side: null, warmup: false, done: false, ...o });
/** n empty sets. Each-side exercises get a left and a right row for every set. */
function blankSets(def, n) {
  return isTimed(def) && def.per_side ? Array.from({ length: n }, () => [blankSet({ side: 'L' }), blankSet({ side: 'R' })]).flat() : Array.from({ length: n }, () => blankSet());
}
/** Timed exercises show a weight box when weight was used last time, and always for carries. */
const wantsWeight = (def, hist) => def.kind === 'carry' || (hist[0]?.sets || []).some(s => s.weight_kg);
/** A new entry with as many sets as last time (at least `min`), filled from history as placeholders. */
async function newEntry(def, min = 3) {
  const hist = await history(def.id);
  const work = (hist[0]?.sets || []).filter(s => !s.warmup);
  const n = Math.max(min, isTimed(def) && def.per_side ? Math.ceil(work.length / 2) : work.length);
  return entryFor(def, blankSets(def, n), isTimed(def) && wantsWeight(def, hist));
}

async function startWorkout(root, routineId, { noWarm = false, cooldown = null } = {}) {
  // A warm-up attached to this routine is offered first.
  if (routineId && !noWarm && !readActive()) {
    const warm = await attachedStretch({ routine: routineId }, 'before');
    if (warm) {
      const go = await confirmSheet(`Warm up first?`, `${warm.name}, about ${Math.max(1, Math.round(warm.est_s / 60))} min, is your warm-up for this routine.`, 'Start warm-up', 'Skip it');
      if (go) { location.hash = `#/train/stretch/run/${warm.id}?next=${encodeURIComponent(`#/train/new?routine=${routineId}&nowarm=1`)}`; return; }
    }
  }
  if (routineId && !cooldown) cooldown = (await attachedStretch({ routine: routineId }, 'after'))?.id || null;
  const existing = readActive();
  if (existing) {
    if (!(await confirmSheet('Workout in progress', `You have ${existing.name} in progress. Discard it and start a new one?`, 'Discard and start'))) {
      location.hash = '#/train/active'; return;
    }
  }
  const exs = await exercises();
  const byId = Object.fromEntries(exs.map(e => [e.id, e]));
  let name = 'Workout';
  let ids = [];
  let plan = [];
  if (routineId) {
    const r = (await get('routines')).routines.find(x => x.id === +routineId);
    if (r) { name = r.name; r.exercise_ids.forEach((id, i) => { if (byId[id]) { ids.push(id); plan.push(r.plan?.[i]?.sets || []); } }); }
  }
  const entries = await Promise.all(ids.map(async (id, i) => {
    // Planned sets come in filled; otherwise as many as last time, filled from history as placeholders.
    const def = byId[id];
    if (!plan[i]?.length) return newEntry(def);
    const kg = (s) => (s.weight_kg == null ? '' : liftDisplay(s.weight_kg));
    if (isTimed(def)) {
      const sets = plan[i].flatMap(s => { const base = { time: fmtHold(s.duration_s), weight: kg(s) }; return def.per_side ? [blankSet({ ...base, side: 'L' }), blankSet({ ...base, side: 'R' })] : [blankSet(base)]; });
      return entryFor(def, sets, plan[i].some(s => s.weight_kg) || wantsWeight(def, await history(id)));
    }
    return entryFor(def, plan[i].map(s => blankSet({ weight: kg(s), reps: s.reps == null ? '' : String(s.reps), warmup: !!s.warmup })));
  }));
  writeActive({ name, date: todayISO(), started_at: Date.now(), exercises: entries, cooldown_id: cooldown ? +cooldown : null });
  location.hash = '#/train/active';
}

let restTimer = null;
let restEnds = 0;
let restOver = false;     // the orange "Rest over" bar is showing
let restPushOff = false;  // the locked-phone push was cancelled because the app is on screen
let reschedule = null;
let holdInt = null;       // the hold timer's tick
let holdWake = null;      // keeps the screen on while a hold runs

function renderActive(root) {
  const w = readActive();
  if (!w) { location.hash = '#/train'; return; }
  const save = () => writeActive(w);
  // Workouts started before timed sets existed: fill in what each exercise is.
  if (w.exercises.some(ex => ex.measure === undefined)) {
    exercises().then(all => {
      const by = Object.fromEntries(all.map(e => [e.id, e]));
      w.exercises.forEach(ex => { if (ex.measure === undefined) Object.assign(ex, { measure: 'reps', per_side: false, hold_s: by[ex.exercise_id]?.hold_s ?? null, kind: by[ex.exercise_id]?.kind || 'lift', weighted: false }); });
      save();
    });
  }
  const restSecs = state.settings?.rest_seconds || 120;

  const minutes = () => Math.max(1, Math.round((Date.now() - w.started_at) / 60000));
  const elapsed = h('span', { class: 'eyebrow' }, `In progress, ${minutes()} min`);
  const nameBtn = h('button', { style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit' }, 'aria-label': `Rename workout, currently ${w.name}`, onclick: () => {
    const s = openSheet({ title: 'Rename workout', body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); w.name = e.target.querySelector('input').value || w.name; save(); s.close(); renderActive(root); } },
      h('input', { class: 'input', value: w.name, 'aria-label': 'Workout name' }), h('button', { class: 'btn primary block', type: 'submit' }, 'Save')) });
  } }, h('h1', null, w.name));

  const restBox = h('div', { class: 'rest', hidden: true, role: 'timer', 'aria-live': 'off' });
  // The next set to do, for the "Rest over" bar and the locked-phone notification.
  const nextUp = (skip = new Set()) => {
    for (const [xi, ex] of w.exercises.entries()) {
      let n = 0;
      for (const [si, s] of ex.sets.entries()) {
        if (!s.warmup && s.side !== 'R') n++;
        if (s.done || skip.has(`${xi}:${si}`)) continue;
        if (isTimed(ex)) {
          const t = s.time || s._phT || fmtHold(ex.hold_s), wt = ex.weighted ? (s.weight || s._phW) : '';
          return `${ex.name} set ${n}${s.side === 'L' ? ', left' : s.side === 'R' ? ', right' : ''}${t ? `, ${t}` : ''}${wt ? ` at +${wt}` : ''}`;
        }
        const wt = s.weight || s._phW, reps = s.reps || s._phR;
        return `${ex.name} ${s.warmup ? 'warm-up' : `set ${n}`}${wt ? `, ${wt}${reps ? ` × ${reps}` : ''}` : reps ? `, ${reps} reps` : ''}`;
      }
    }
    return null;
  };
  const fmtLeft = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const pushRest = () => {
    clearTimeout(reschedule);
    restPushOff = false;
    const secs = (restEnds - Date.now()) / 1000;
    if (secs < 3) { cancelRestPush(); return; }
    const nx = nextUp();
    reschedule = setTimeout(() => scheduleRestPush(secs - 0.4, { title: 'Rest over', body: `${nx ? `${nx}. ` : ''}Tap to go back to ${w.name}.` }), 400);
  };
  const muteBtn = () => h('button', { class: 'icon-btn rest-mute', 'aria-label': w.rest_muted ? 'Sound off for this workout' : 'Sound on', 'aria-pressed': String(!w.rest_muted),
    onclick: () => { w.rest_muted = !w.rest_muted; save(); drawRest(); } }, icon(w.rest_muted ? 'muted' : 'sound', 20));
  const drawRest = () => {
    if (restOver) {
      const nx = nextUp();
      restBox.hidden = false; restBox.classList.add('over'); restBox.setAttribute('role', 'alert');
      restBox.replaceChildren(
        icon('bell', 26),
        h('span', { class: 'rest-text' }, h('span', { class: 'rest-title' }, 'Rest over'), nx ? h('span', { class: 'small' }, `Next: ${nx}`) : null),
        h('button', { class: 'btn sm outline-light', onclick: () => { restOver = false; unlockAudio(); restEnds = Date.now() + 30000; startTicking(); pushRest(); } }, '+30 s'),
        h('button', { class: 'btn sm light', onclick: () => { restOver = false; drawRest(); } }, 'OK'));
      return;
    }
    restBox.classList.remove('over'); restBox.setAttribute('role', 'timer');
    const left = Math.round((restEnds - Date.now()) / 1000);
    if (left <= 0) {
      restBox.hidden = true; clearInterval(restTimer); restTimer = null;
      if (restEnds) {
        const late = Date.now() - restEnds;
        restEnds = 0; restOver = true;
        // Only ring if we're on time: coming back to the app long after, the push already did it.
        if (late < 4000) ring(w.rest_muted);
        drawRest();
      }
      return;
    }
    // On screen near the end: the tone will play here, so the push isn't needed.
    if (left <= 2 && !restPushOff && document.visibilityState === 'visible') { restPushOff = true; cancelRestPush(); }
    restBox.hidden = false;
    restBox.replaceChildren(
      h('span', { style: { display: 'flex', flexDirection: 'column' } }, h('span', { class: 'small', style: { color: 'var(--on-deep-muted)' } }, 'Rest'),
        h('span', { class: 'num', style: { fontSize: '30px' } }, fmtLeft(left))),
      h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        muteBtn(),
        h('button', { class: 'btn sm', onclick: () => { restEnds -= 15000; drawRest(); if (restEnds > Date.now()) pushRest(); } }, '-15 s'),
        h('button', { class: 'btn sm', onclick: () => { restEnds += 15000; drawRest(); pushRest(); } }, '+15 s'),
        h('button', { class: 'btn sm light', onclick: () => { restEnds = 0; restOver = false; clearTimeout(reschedule); cancelRestPush(); drawRest(); } }, 'Skip')));
  };
  const startTicking = () => { clearInterval(restTimer); restTimer = setInterval(drawRest, 1000); drawRest(); };
  const startRest = () => { unlockAudio(); restOver = false; restEnds = Date.now() + restSecs * 1000; startTicking(); pushRest(); };
  const stopRest = () => { if (restEnds) { clearTimeout(reschedule); cancelRestPush(); } restEnds = 0; restOver = false; clearInterval(restTimer); restTimer = null; };
  if (restEnds > Date.now() || restOver) startTicking();
  else if (restEnds) { restEnds = 0; } // ended while you were on another screen
  // Back from another app or the lock screen: catch up at once instead of on the next tick.
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (restEnds || restOver) drawRest();
    if (w.hold) { holdWake = null; keepAwake(true); tickHold(); }
  };
  document.addEventListener('visibilitychange', onVisible);

  let effOpen = null; // which set's effort picker is open, as 'exercise:set'
  const cards = h('div', { class: 'stack' });
  const drawCards = () => { holdUI.inline = null; cards.replaceChildren(...w.exercises.map((ex, xi) => (isTimed(ex) ? timedCard(ex, xi) : exerciseCard(ex, xi)))); paintHold(); };

  /* ----- timed sets and the hold timer ----- */
  const holdUI = { inline: null, full: null };
  const dropHold = () => { if (!w.hold) return; w.hold = null; clearInterval(holdInt); holdInt = null; clearTimeout(reschedule); cancelRestPush(); keepAwake(false); holdUI.full?.root.remove(); holdUI.full = null; };
  const setLabels = (ex) => { let n = 0; return ex.sets.map(s => (s.warmup ? 'W' : `${s.side === 'R' && n ? n : ++n}${s.side || ''}`)); };
  const rowOf = (hh, side) => (hh.sides && side === 'R' ? hh.si + 1 : hh.si);
  const holdTarget = (ex, s) => parseHold(s.time) || parseHold(s._phT) || ex.hold_s || null;
  const keepAwake = async (on) => {
    try { if (on && !holdWake) holdWake = await navigator.wakeLock?.request('screen'); else if (!on && holdWake) { const l = holdWake; holdWake = null; await l.release(); } } catch { holdWake = null; }
  };
  const beep = () => { const a = alarmSettings(); if (a.sound && !w.rest_muted) playTone('beeps', a.volume); if (a.vibrate) navigator.vibrate?.(120); };
  // The locked-phone notification for the moment the target is reached.
  const holdPush = () => {
    const hh = w.hold;
    clearTimeout(reschedule);
    if (!hh || hh.pauseAt || !hh.target) return;
    const st = holdNow(hh, Date.now());
    if (st.phase === 'hold' && st.over) return;
    const secs = st.phase === 'hold' ? st.left : st.left + hh.target;
    if (secs < 3) return;
    const ex = w.exercises[hh.xi];
    hh.pushOff = false;
    reschedule = setTimeout(() => scheduleRestPush(secs - 0.4, { title: `${fmtHold(hh.target)} hold done`,
      body: hh.sides && hh.side === 'L' ? `${ex.name}: switch to the right side.` : `${ex.name}. Tap to go back to ${w.name}.` }), 400);
  };
  const endHold = (logged) => {
    w.hold = null; save();
    clearInterval(holdInt); holdInt = null; keepAwake(false); closeFull();
    clearTimeout(reschedule); cancelRestPush();
    drawCards();
    if (logged) startRest();
  };
  const handleHold = (ev) => {
    const hh = w.hold;
    if (!hh) return;
    const ex = w.exercises[hh.xi];
    let redraw = false;
    for (const e of ev) {
      if (e.type === 'go') beep();
      else if (e.type === 'target') ring(w.rest_muted);
      else if (e.type === 'log') {
        const s = ex?.sets[rowOf(hh, e.side)];
        if (s) { s.time = fmtHold(e.sec); s.done = true; if (ex.weighted && !s.weight && s._phW) s.weight = s._phW; }
        redraw = true;
        if (hh.sides && e.side === 'L') holdPush();
      } else if (e.type === 'done' || e.type === 'cancel') { endHold(e.type === 'done'); return; }
    }
    save();
    if (redraw) drawCards();
  };
  const tickHold = () => {
    const hh = w.hold;
    if (!hh) { clearInterval(holdInt); holdInt = null; return; }
    const now = Date.now();
    const ev = advanceHold(hh, now);
    if (ev.length) { handleHold(ev); if (!w.hold) return; }
    // On screen near the target: the tone plays here, so the notification isn't needed.
    const st = holdNow(hh, now);
    if (!hh.pushOff && hh.target && document.visibilityState === 'visible' && st.phase === 'hold' && st.left != null && st.left <= 2) { hh.pushOff = true; clearTimeout(reschedule); cancelRestPush(); }
    paintHold(now);
  };
  const runHold = () => { clearInterval(holdInt); holdInt = setInterval(tickHold, 250); keepAwake(true); tickHold(); };
  const startHold = (xi, si) => {
    if (w.hold) { w.hold = null; clearInterval(holdInt); holdInt = null; }
    const ex = w.exercises[xi], s = ex.sets[si];
    const sides = !!(ex.per_side && s.side === 'L' && ex.sets[si + 1]?.side === 'R');
    unlockAudio(); stopRest(); drawRest();
    w.hold = { xi, si, full: holdUI.full != null, ...newHold({ now: Date.now(), target: holdTarget(ex, s), sides, side: s.side || null }) };
    save(); drawCards(); runHold(); holdPush();
  };
  const holdPauseToggle = () => {
    const hh = w.hold; if (!hh) return;
    const now = Date.now();
    if (hh.pauseAt) { resumeHold(hh, now); holdPush(); } else { pauseHold(hh, now); clearTimeout(reschedule); cancelRestPush(); }
    save(); drawCards();
  };
  const holdExtend = () => { const hh = w.hold; if (!hh) return; extendHold(hh, Date.now()); save(); holdPush(); paintHold(); };
  /** Start now during the count-in or switch; otherwise stop and log this side. */
  const holdMain = () => {
    const hh = w.hold; if (!hh) return;
    const now = Date.now();
    if (holdNow(hh, now).phase !== 'hold') { skipLead(hh, now); save(); holdPush(); tickHold(); return; }
    handleHold(stopHold(hh, now));
    if (w.hold) { save(); drawCards(); holdPush(); }
  };
  const holdStop = () => { const hh = w.hold; if (!hh) return; handleHold(stopHold(hh, Date.now())); if (w.hold) { save(); drawCards(); holdPush(); } };

  const holdPanel = () => {
    const num = h('span', { class: 'hold-num' }), sub = h('span', { class: 'hold-sub' }), title = h('span', { class: 'hold-title' });
    const fill = h('span', { class: 'hold-fill' });
    const pause = h('button', { class: 'btn sm outline-light', onclick: holdPauseToggle });
    const main = h('button', { class: 'btn sm light', onclick: holdMain });
    const root = h('div', { class: 'hold-box', role: 'timer', 'aria-live': 'off' },
      h('div', { class: 'hold-top' }, title, h('span', { class: 'hold-icons' },
        h('button', { class: 'icon-btn hold-ic', 'aria-label': 'Full screen timer', onclick: openFull }, icon('expand', 18)),
        h('button', { class: 'icon-btn hold-ic', 'aria-label': 'Cancel the timer', onclick: () => endHold(false) }, icon('close', 18)))),
      h('div', { class: 'hold-read' }, num, sub),
      h('div', { class: 'hold-bar', 'aria-hidden': 'true' }, fill),
      h('div', { class: 'hold-ctl' }, pause, h('button', { class: 'btn sm outline-light', onclick: holdExtend }, '+15 s'), main));
    return { root, num, sub, title, pause, main, setFrac: (f) => { fill.style.width = `${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%`; } };
  };
  const C = 2 * Math.PI * 110;
  const buildFull = () => {
    closeFull();
    const hh = w.hold; if (!hh) return;
    const ex = w.exercises[hh.xi];
    const svg = svgRing(C, 0, false), arc = svg.lastChild;
    const num = h('b'), sub = h('span'), title = h('span', { style: { fontWeight: 600 } }), pill = h('span', { class: 'run-side' }), nextB = h('b');
    const statT = h('b'), statL = h('b'), statB = h('b');
    const muteB = h('button', { class: 'icon-btn run-mute', onclick: () => { w.rest_muted = !w.rest_muted; save(); paintHold(); } });
    const pause = h('button', { class: 'btn outline-light', onclick: holdPauseToggle });
    const main = h('button', { class: 'btn light', onclick: holdMain });
    const root = h('div', { class: 'stretch-run hold-run', role: 'dialog', 'aria-label': `${ex.name} hold timer` },
      h('div', { class: 'run-top' },
        h('button', { class: 'icon-btn run-mute', 'aria-label': 'Back to the workout', onclick: () => { closeFull(); } }, icon('shrink', 20)),
        h('span', { class: 'run-title' }, h('span', { class: 'tiny' }, w.name), title), muteB),
      h('div', { class: 'run-name' }, h('h1', null, ex.name), pill),
      h('div', { class: 'run-ring' }, svg, h('span', { class: 'run-num' }, num, sub)),
      h('div', { class: 'hold-stats' },
        h('span', null, statT, h('span', null, 'target')), h('span', null, statL, h('span', null, 'last time')), h('span', null, statB, h('span', null, 'best hold'))),
      h('div', { class: 'run-next' }, h('span', { class: 'tiny' }, 'Up next'), nextB),
      h('div', { class: 'run-ctl' }, pause, h('button', { class: 'btn outline-light', onclick: holdExtend }, '+15 s'), main));
    document.body.append(root);
    history(ex.exercise_id).then(hist => { const b = Math.max(0, ...hist.flatMap(x => x.sets.map(s => s.duration_s || 0))); statB.textContent = b ? fmtHold(b) : '-'; });
    holdUI.full = { root, num, sub, title, pause, main, pill, nextB, statT, statL, muteB, full: true, setFrac: (f) => arc.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(1, f)))).toFixed(1)), arc };
    hh.full = true; save();
    paintHold();
  };
  const openFull = () => { if (w.hold) buildFull(); };
  const closeFull = () => { holdUI.full?.root.remove(); holdUI.full = null; if (w.hold && w.hold.full) { w.hold.full = false; save(); } };

  /** Writes the timer's state into the inline panel and the full-screen view. */
  const paintHold = (now = Date.now()) => {
    const hh = w.hold;
    if (!hh) return;
    const ex = w.exercises[hh.xi];
    if (!ex) return;
    const st = holdNow(hh, now);
    const labels = setLabels(ex);
    const s = ex.sets[rowOf(hh, hh.side)];
    const sideName = hh.side === 'L' ? 'left side' : hh.side === 'R' ? 'right side' : '';
    let num, sub, frac, over = false;
    if (st.phase !== 'hold') {
      num = String(Math.max(1, Math.ceil(st.left)));
      sub = st.phase === 'switch' ? 'Switch to the right side' : 'Get into position';
      frac = hh.lead ? 1 - st.left / hh.lead : 1;
    } else if (hh.target && !st.over) {
      num = fmtHold(Math.ceil(st.left)); sub = `left of ${fmtHold(hh.target)}`; frac = st.held / hh.target;
    } else if (hh.target) {
      num = fmtHold(Math.floor(st.held)); sub = `+${fmtHold(Math.floor(st.held - hh.target))} past ${fmtHold(hh.target)}`; frac = 1; over = true;
    } else { num = fmtHold(Math.floor(st.held)); sub = 'held so far'; frac = 0; }
    if (hh.pauseAt) sub = `Paused. ${sub}`;
    const stopLabel = st.phase !== 'hold' ? 'Start now' : hh.sides && hh.side === 'L' ? 'Log, switch sides' : 'Stop and log';
    for (const ui of [holdUI.inline, holdUI.full]) {
      if (!ui) continue;
      ui.num.textContent = num; ui.sub.textContent = sub; ui.setFrac(frac);
      ui.root.classList.toggle('over', over);
      ui.root.classList.toggle('lead', st.phase !== 'hold');
      ui.pause.textContent = hh.pauseAt ? 'Resume' : 'Pause';
      ui.main.textContent = ui.full && st.phase === 'hold' && !(hh.sides && hh.side === 'L') ? `Stop and log ${fmtHold(Math.floor(st.held))}` : stopLabel;
      const setNo = (labels[rowOf(hh, hh.side)] || '').replace(/[LR]$/, '');
      ui.title.textContent = `Set ${setNo} hold${sideName && !ui.full ? `, ${sideName}` : ''}`;
      ui.root.setAttribute('aria-label', `${ex.name} set ${labels[hh.si]} hold, ${num} ${sub}`);
    }
    const f = holdUI.full;
    if (f) {
      f.arc.setAttribute('stroke', st.phase !== 'hold' ? '#B8C6DC' : '#FF914D');
      const pill = st.phase === 'countin' ? 'Get ready' : st.phase === 'switch' ? 'Switch sides' : over ? 'Target reached, keep going' : sideName ? sideName[0].toUpperCase() + sideName.slice(1) : '';
      f.pill.textContent = pill; f.pill.hidden = !pill;
      f.statT.textContent = hh.target ? fmtHold(hh.target) : '-';
      f.statL.textContent = s?._phT || '-';
      const skip = new Set([`${hh.xi}:${hh.si}`, `${hh.xi}:${rowOf(hh, 'R')}`]);
      const nx = nextUp(skip);
      f.nextB.textContent = hh.sides && hh.side === 'L' ? `Right side, after a ${5} s switch` : `Rest ${fmtHold(restSecs)}${nx ? `, then ${nx}` : ''}`;
      f.muteB.replaceChildren(icon(w.rest_muted ? 'muted' : 'sound', 20));
      f.muteB.setAttribute('aria-label', w.rest_muted ? 'Sound off' : 'Sound on'); f.muteB.setAttribute('aria-pressed', String(!w.rest_muted));
    }
  };

  const timedCard = (ex, xi) => {
    const card = h('section', { class: 'card', 'aria-label': ex.name, style: { gap: '6px' } });
    const best = h('span', { class: 'small muted' });
    const labels = setLabels(ex);
    const lastCells = [];
    history(ex.exercise_id).then(hist => {
      const b = Math.max(0, ...hist.flatMap(x => x.sets.filter(s => !s.warmup).map(s => s.duration_s || 0)));
      if (b) best.textContent = `Best hold ${fmtHold(b)}`;
      const lastWork = (hist[0]?.sets || []).filter(s => !s.warmup);
      let ki = 0;
      const rowsEls = card.querySelectorAll('.set-row');
      ex.sets.forEach((s, i) => {
        const src = s.warmup ? null : lastWork[ki++];
        if (lastCells[i]) lastCells[i].textContent = src ? `${fmtHold(src.duration_s) || '-'}${src.weight_kg && !ex.weighted ? ` +${liftDisplay(src.weight_kg)}` : ''}` : '-';
        if (src && !s.done) {
          s._phT = fmtHold(src.duration_s); s._phW = liftDisplay(src.weight_kg);
          const r = rowsEls[i];
          if (r) { if (s._phT) r.querySelector('.t-in').placeholder = s._phT; const wi = r.querySelector('.w-in'); if (wi && s._phW) wi.placeholder = s._phW; }
        }
      });
      paintHold();
    });
    const hh = w.hold && w.hold.xi === xi ? w.hold : null;
    const rows = ex.sets.flatMap((s, si) => {
      const label = labels[si];
      const lastCell = h('span', { class: 'small muted' }, '-');
      lastCells[si] = lastCell;
      const tIn = h('input', { class: 't-in', inputmode: 'numeric', value: s.time, placeholder: s._phT || fmtHold(ex.hold_s) || '', 'aria-label': `Set ${label} time` });
      tIn.addEventListener('input', () => { s.time = tIn.value; save(); });
      tIn.addEventListener('blur', () => { const v = parseHold(tIn.value); if (v) { s.time = fmtHold(v); tIn.value = s.time; save(); } });
      const wIn = ex.weighted ? h('input', { class: 'w-in', inputmode: 'decimal', value: s.weight, placeholder: s._phW || '', 'aria-label': `Set ${label} added weight in ${wUnit()}` }) : null;
      wIn?.addEventListener('input', () => { s.weight = wIn.value; save(); });
      const key = `${xi}:${si}`;
      const effBtn = s.warmup ? h('span', { class: 'eff-none', 'aria-hidden': 'true' }, '')
        : h('button', { class: 'eff-btn' + (s.rpe ? ' set' : ''), 'aria-expanded': String(effOpen === key), 'aria-label': s.rpe ? `Set ${label} effort ${s.rpe}, change` : `Set ${label} effort`,
          onclick: () => { effOpen = effOpen === key ? null : key; drawCards(); } }, s.rpe ? String(s.rpe) : '–');
      const effRow = effOpen === key && !s.warmup ? h('div', { class: 'eff-pick', role: 'group', 'aria-label': `Set ${label} effort` },
        h('span', { class: 'small', style: { fontWeight: 600 } }, `Set ${label} effort`),
        h('div', { class: 'eff-scale' }, Array.from({ length: 10 }, (_, k) => k + 1).map(v => h('button', { 'aria-pressed': String(s.rpe === v),
          onclick: () => { s.rpe = s.rpe === v ? null : v; save(); effOpen = null; drawCards(); } }, String(v)))),
        h('div', { class: 'eff-anchors tiny muted' }, h('span', null, '1 easy'), h('span', null, '8 nearly done'), h('span', null, '10 nothing left'))) : null;
      const running = !!hh && rowOf(hh, hh.side) === si;
      const timerBtn = h('button', { class: 'timer-btn' + (running ? ' on' : ''),
        'aria-label': running ? (hh.pauseAt ? `Resume set ${label} timer` : `Pause set ${label} timer`) : `Start set ${label} timer`,
        onclick: () => (running ? holdPauseToggle() : startHold(xi, si)) }, icon(running && !hh.pauseAt ? 'pause' : 'play', 18));
      const doneBtn = h('button', { class: 'done-btn', 'aria-pressed': String(!!s.done), 'aria-label': s.done ? `Set ${label} done` : `Mark set ${label} done`, onclick: () => {
        if (running) { holdStop(); return; }
        if (!s.done) {
          if (!parseHold(s.time)) s.time = s._phT || fmtHold(ex.hold_s) || s.time;
          if (!parseHold(s.time)) { toast('Enter a time first', 'error'); return; }
          if (ex.weighted && !s.weight && s._phW) s.weight = s._phW;
        }
        s.done = !s.done; save(); drawCards();
        if (s.done) startRest();
      } }, icon('check'));
      const out = [h('div', { class: `set-grid tx${ex.weighted ? ' wt' : ''} set-row${s.done ? ' done' : ''}${running ? ' timing' : ''}` },
        h('button', { class: 'set-n', 'aria-label': `Set ${label} options`, onclick: () => setMenu(ex, si) }, label),
        lastCell, wIn, tIn, effBtn, timerBtn, doneBtn), effRow];
      if (hh && rowOf(hh, 'R') === si) { holdUI.inline = holdPanel(); out.push(holdUI.inline.root); }
      return out.filter(Boolean);
    });
    card.append(...[
      h('div', { class: 'card-head', style: { alignItems: 'center' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } }, h('h2', { style: { font: '600 18px var(--body)' } }, ex.name), best),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
          h('button', { class: 'btn sm wt-toggle', 'aria-pressed': String(!!ex.weighted), onclick: () => { ex.weighted = !ex.weighted; save(); drawCards(); } },
            ex.weighted ? 'No weight' : [icon('plus', 14), 'Add weight']),
          h('button', { class: 'icon-btn', 'aria-label': `Options for ${ex.name}`, onclick: () => exerciseMenu(xi) }, icon('more')))),
      h('div', { class: `set-grid tx${ex.weighted ? ' wt' : ''} head` }, h('span', { style: { textAlign: 'center' } }, 'Set'), h('span', null, 'Last time'),
        ex.weighted ? h('span', null, `+${wUnit()}`) : null, h('span', null, 'Time'), h('span', { style: { textAlign: 'center' } }, 'Effort'),
        h('span', { style: { textAlign: 'center' } }, 'Timer'), h('span', { style: { textAlign: 'center' } }, 'Done')),
      ...rows,
      ex.per_side ? h('span', { class: 'tiny muted', style: { padding: '2px 4px' } }, 'The timer runs left, gives a 5 s switch, then runs right.') : null,
      h('button', { class: 'btn sm dashed', style: { marginTop: '6px', borderStyle: 'dashed' }, onclick: () => {
        const prev = ex.sets[ex.sets.length - 1];
        const base = { time: prev?.time || '', weight: prev?.weight || '' };
        ex.sets.push(...(ex.per_side ? [blankSet({ ...base, side: 'L' }), blankSet({ ...base, side: 'R' })] : [blankSet(base)]));
        save(); drawCards();
      } }, 'Add set')].filter(Boolean));
    return card;
  };

  const exerciseCard = (ex, xi) => {
    const card = h('section', { class: 'card', 'aria-label': ex.name, style: { gap: '6px' } });
    const best = h('span', { class: 'small muted' });
    const lastCells = [];
    history(ex.exercise_id).then(hist => {
      const all = hist.flatMap(x => x.sets.filter(s => !s.warmup).map(s => e1rm(s.weight_kg, s.reps))).filter(Boolean);
      if (all.length) best.textContent = `Best e1RM ${liftDisplay(Math.max(...all))} ${wUnit()}`;
      const last = (hist[0]?.sets || []);
      const lastWarm = last.filter(s => s.warmup), lastWork = last.filter(s => !s.warmup);
      let wi = 0, ki = 0;
      ex.sets.forEach((s, i) => {
        const src = s.warmup ? lastWarm[wi++] : lastWork[ki++];
        if (lastCells[i]) lastCells[i].textContent = src ? `${liftDisplay(src.weight_kg) || 'BW'} x ${src.reps ?? '-'}` : '-';
        if (src && !s.weight && !s.done) { s._phW = liftDisplay(src.weight_kg); s._phR = src.reps; const r = card.querySelectorAll('.set-row')[i]; if (r) { r.querySelector('.w-in').placeholder = s._phW; r.querySelector('.r-in').placeholder = s._phR ?? ''; } }
      });
    });
    let wNum = 0;
    const rows = ex.sets.flatMap((s, si) => {
      const label = s.warmup ? 'W' : String(++wNum);
      const lastCell = h('span', { class: 'small muted' }, '-');
      lastCells[si] = lastCell;
      const wIn = h('input', { class: 'w-in', inputmode: 'decimal', value: s.weight, placeholder: s._phW || '', 'aria-label': `Set ${label} weight in ${wUnit()}` });
      const rIn = h('input', { class: 'r-in', inputmode: 'numeric', value: s.reps, placeholder: s._phR ?? '', 'aria-label': `Set ${label} reps` });
      wIn.addEventListener('input', () => { s.weight = wIn.value; save(); });
      rIn.addEventListener('input', () => { s.reps = rIn.value; save(); });
      const key = `${xi}:${si}`;
      const effBtn = s.warmup ? h('span', { class: 'eff-none', 'aria-hidden': 'true' }, '')
        : h('button', { class: 'eff-btn' + (s.rpe ? ' set' : ''), 'aria-expanded': String(effOpen === key), 'aria-label': s.rpe ? `Set ${label} effort ${s.rpe}, change` : `Set ${label} effort`,
          onclick: () => { effOpen = effOpen === key ? null : key; drawCards(); } }, s.rpe ? String(s.rpe) : '–');
      const effRow = effOpen === key && !s.warmup ? h('div', { class: 'eff-pick', role: 'group', 'aria-label': `Set ${label} effort` },
        h('span', { class: 'small', style: { fontWeight: 600 } }, `Set ${label} effort`),
        h('div', { class: 'eff-scale' }, Array.from({ length: 10 }, (_, k) => k + 1).map(v => h('button', { 'aria-pressed': String(s.rpe === v),
          onclick: () => { s.rpe = s.rpe === v ? null : v; save(); effOpen = null; drawCards(); } }, String(v)))),
        h('div', { class: 'eff-anchors tiny muted' }, h('span', null, '1 easy'), h('span', null, '8 two reps left'), h('span', null, '10 nothing left'))) : null;
      return [h('div', { class: 'set-grid fx set-row' + (s.done ? ' done' : '') },
        h('button', { class: 'set-n', 'aria-label': `Set ${label} options`, onclick: () => setMenu(ex, si) }, label),
        lastCell, wIn, rIn, effBtn,
        h('button', { class: 'done-btn', 'aria-pressed': String(!!s.done), 'aria-label': s.done ? `Set ${label} done` : `Mark set ${label} done`, onclick: () => {
          if (!s.done) {
            if (!s.weight && s._phW) s.weight = s._phW;
            if (!s.reps && s._phR != null) s.reps = String(s._phR);
            if (!s.reps) { toast('Enter reps first', 'error'); return; }
          }
          s.done = !s.done; save(); drawCards();
          if (s.done) startRest();
        } }, icon('check'))), effRow].filter(Boolean);
    });
    card.append(
      h('div', { class: 'card-head' },
        h('h2', { style: { font: '600 18px var(--body)' } }, ex.name),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, best,
          h('button', { class: 'icon-btn', 'aria-label': `Options for ${ex.name}`, onclick: () => exerciseMenu(xi) }, icon('more')))),
      h('div', { class: 'set-grid fx head' }, h('span', { style: { textAlign: 'center' } }, 'Set'), h('span', null, 'Last time'), h('span', null, wUnit()), h('span', null, 'Reps'), h('span', { style: { textAlign: 'center' } }, 'Effort'), h('span', { style: { textAlign: 'center' } }, 'Done')),
      ...rows,
      h('button', { class: 'btn sm dashed', style: { marginTop: '6px', borderStyle: 'dashed' }, onclick: () => {
        const prev = ex.sets[ex.sets.length - 1];
        ex.sets.push({ weight: prev?.weight || '', reps: '', warmup: false, done: false }); save(); drawCards();
      } }, 'Add set'));
    return card;
  };

  const setMenu = (ex, si) => {
    const s = ex.sets[si];
    const sh = openSheet({ title: 'Set options', body: h('div', { class: 'stack' },
      h('button', { class: 'btn block', onclick: () => { s.warmup = !s.warmup; save(); sh.close(); drawCards(); } }, s.warmup ? 'Make it a working set' : 'Mark as warm-up'),
      h('button', { class: 'btn block danger', onclick: () => { if (w.hold && w.exercises[w.hold.xi] === ex) endHold(false); ex.sets.splice(si, 1); save(); sh.close(); drawCards(); } }, 'Delete set')) });
  };
  const exerciseMenu = (xi) => {
    const ex = w.exercises[xi];
    const sh = openSheet({ title: ex.name, body: h('div', { class: 'stack' },
      h('a', { class: 'btn block', href: `#/train/exercise/${ex.exercise_id}`, onclick: () => sh.close() }, 'History and progress'),
      w.exercises.length > 1 ? h('button', { class: 'btn block', onclick: () => { sh.close(); reorderSheet(); } }, 'Reorder exercises') : null,
      ex.sets.some(s => s.warmup) || isTimed(ex) ? null : h('button', { class: 'btn block', onclick: async () => {
        sh.close();
        const work = Math.max(0, ...ex.sets.filter(s => !s.warmup).map(s => parseFloat(s.weight || s._phW) || 0));
        const all = await exercises();
        const ramp = warmupRamp(work, all.find(e => e.id === ex.exercise_id)?.equipment);
        if (!ramp.length) { toast('Enter a working weight first', 'error'); return; }
        ex.sets.unshift(...ramp.map(r => ({ weight: String(r.w), reps: String(r.r), warmup: true, done: false })));
        save(); drawCards();
      } }, 'Add warm-ups'),
      h('button', { class: 'btn block', onclick: () => { sh.close(); pickExercise(async (n) => {
        if (w.hold?.xi === xi) endHold(false);
        // Same kind of sets: keep them. Reps to time (or back): start fresh with as many sets.
        const entry = !isTimed(n) && !isTimed(ex) ? entryFor(n, ex.sets.map(s => ({ ...s, done: false })))
          : await newEntry(n, Math.max(1, ex.sets.filter(s => !s.warmup && s.side !== 'R').length));
        w.exercises[xi] = entry; save(); drawCards();
      }); } }, 'Replace exercise'),
      h('button', { class: 'btn block danger', onclick: () => { if (w.hold?.xi === xi) endHold(false); else if (w.hold && w.hold.xi > xi) w.hold.xi--; w.exercises.splice(xi, 1); save(); sh.close(); drawCards(); } }, 'Remove exercise')) });
  };

  const reorderSheet = () => {
    openSheet({
      title: 'Reorder exercises',
      onClose: () => drawCards(),
      body: (sheet) => {
        const list = h('div', { class: 'list' });
        const draw = () => list.replaceChildren(...w.exercises.map((ex, i) => h('div', { class: 'list-row sort-row', 'data-key': String(i), 'data-label': ex.name },
          gripHandle(ex.name),
          h('div', { class: 'main' }, h('span', { class: 'title' }, ex.name), h('span', { class: 'small muted' }, `${ex.sets.filter(s => s.done).length} of ${ex.sets.length} sets done`)))));
        makeSortable(list, { onChange: (keys) => { if (w.hold) endHold(false); w.exercises = keys.map(k => w.exercises[+k]); save(); draw(); } });
        draw();
        sheet.body.append(h('p', { class: 'note small' }, 'Drag the handle to move an exercise.'), list, h('button', { class: 'btn primary block', onclick: () => sheet.close() }, 'Done'));
      },
    });
  };

  const collectSets = () => {
    const sets = [];
    w.exercises.forEach((ex) => ex.sets.forEach((s) => {
      if (isTimed(ex)) {
        // A timed set needs a time; added weight only counts when the weight box is showing.
        const sec = parseHold(s.time);
        if (!sec) return;
        sets.push({ exercise_id: ex.exercise_id, position: sets.length, reps: null, duration_s: sec, side: s.side || null, warmup: s.warmup, rpe: s.warmup ? null : (s.rpe || null),
          weight_kg: ex.weighted && s.weight !== '' && s.weight != null ? fromDisplayW(String(s.weight).replace(',', '.')) : null });
        return;
      }
      const reps = parseInt(s.reps || '', 10);
      if (!s.done && !reps) return;
      sets.push({ exercise_id: ex.exercise_id, position: sets.length, reps: reps || null, weight_kg: s.weight !== '' ? fromDisplayW(String(s.weight).replace(',', '.')) : null, warmup: s.warmup, rpe: s.warmup ? null : (s.rpe || null) });
    }));
    return sets;
  };
  const save_ = async (effort) => {
    const sets = collectSets();
    try {
      const r = await post('workouts/save', { id: w.id, date: w.date, name: w.name, notes: w.notes || null, duration_min: w.duration_min || minutes(), effort: effort || null, sets });
      dropHold(); writeActive(null); histCache.clear(); stopRest();
      toast(r.queued ? 'Workout saved offline. It will sync when you reconnect.' : 'Workout saved');
      const after = r.queued ? '#/train' : `#/train/${r.workout.id}`;
      // A cool-down attached to the routine (or the scheduled session) comes next.
      location.hash = w.cooldown_id && !r.queued ? `#/train/stretch/run/${w.cooldown_id}?next=${encodeURIComponent(after)}` : after;
    } catch (e) { toast(e.message, 'error'); }
  };
  const finish = async () => {
    const sets = collectSets();
    if (!sets.length) {
      if (await confirmSheet('Nothing logged', 'No sets have reps or times yet. Discard this workout?', 'Discard')) { stopRest(); dropHold(); writeActive(null); location.hash = '#/train'; }
      return;
    }
    const kinds = Object.fromEntries((await exercises()).map(e => [e.id, e.kind || 'lift']));
    const work = sets.filter(s => !s.warmup);
    const vol = work.filter(s => ['lift', 'olympic'].includes(kinds[s.exercise_id] || 'lift')).reduce((a, s) => a + (s.weight_kg || 0) * (s.reps || 0), 0);
    const efforts = work.map(s => s.rpe).filter(Boolean);
    let effort = w.effort || null;
    openSheet({
      title: 'Finish workout',
      body: (sheet) => {
        const scale = h('div', { class: 'eff-scale' });
        const drawScale = () => scale.replaceChildren(...Array.from({ length: 10 }, (_, k) => k + 1).map(v => h('button', { 'aria-pressed': String(effort === v), onclick: () => { effort = effort === v ? null : v; w.effort = effort; save(); drawScale(); } }, String(v))));
        drawScale();
        sheet.body.append(
          h('div', { class: 'grid-3' },
            h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px' } }, work.length), h('span', { class: 'label' }, 'working sets')),
            h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px' } }, efforts.length ? fmt1(efforts.reduce((a, b) => a + b, 0) / efforts.length) : '-'), h('span', { class: 'label' }, 'average set effort')),
            h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px' } }, fmt0(toDisplayW(vol))), h('span', { class: 'label' }, `${wUnit()} volume`))),
          h('div', { class: 'field' }, h('span', null, 'How hard was the whole session?'), h('span', { class: 'tiny muted', style: { fontWeight: 400 } }, 'Optional. 1 is easy, 10 is everything you had.'), scale),
          h('button', { class: 'btn primary block', onclick: () => { sheet.close(); save_(effort); } }, 'Save workout'));
      },
    });
  };

  drawCards();
  root.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, elapsed, nameBtn),
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmSheet('Discard workout?', 'Everything logged in this session will be lost.', 'Discard')) { stopRest(); dropHold(); writeActive(null); location.hash = '#/train'; } } }, 'Discard'),
        h('button', { class: 'btn sm primary', onclick: finish }, 'Finish'))),
    h('div', { class: 'stack', style: { maxWidth: '760px' } },
      restBox,
      cards,
      h('button', { class: 'btn block', onclick: () => pickExercise(async (ex) => { w.exercises.push(await newEntry(ex)); save(); drawCards(); }) }, 'Add exercise'),
      h('label', { class: 'field' }, 'Notes', h('textarea', { oninput: (e) => { w.notes = e.target.value; save(); } }, w.notes || ''))));

  // A hold that was running when you left (or the app reloaded) carries on from its timestamps.
  if (w.hold) { runHold(); if (w.hold?.full) buildFull(); }

  const tick = setInterval(() => { elapsed.textContent = `In progress, ${minutes()} min`; }, 30000);
  return () => {
    clearInterval(tick); clearInterval(restTimer); restTimer = null; document.removeEventListener('visibilitychange', onVisible);
    clearInterval(holdInt); holdInt = null; holdUI.full?.root.remove(); holdUI.full = null; keepAwake(false);
  };
}

/* ---------- saved workout ---------- */

async function renderSaved(root, id) {
  root.replaceChildren(loading());
  const { workout: w } = await get('workouts/get', { id });
  const groups = [];
  w.sets.forEach(s => {
    let g = groups[groups.length - 1];
    if (!g || g.exercise_id !== s.exercise_id) { g = { exercise_id: s.exercise_id, name: s.exercise, sets: [] }; groups.push(g); }
    g.sets.push(s);
  });
  root.replaceChildren(
    pageHead(`${shortDate(w.date)}${w.duration_min ? `, ${w.duration_min} min` : ''}`, w.name, [
      h('button', { class: 'btn sm', onclick: async () => {
        if (readActive()) { toast('Finish or discard the workout in progress first', 'error'); return; }
        const by = Object.fromEntries((await exercises()).map(e => [e.id, e]));
        writeActive({ id: w.id, name: w.name, date: w.date, notes: w.notes, duration_min: w.duration_min, effort: w.effort, started_at: Date.now(),
          exercises: groups.map(g => {
            const def = by[g.exercise_id] || { id: g.exercise_id, name: g.name, measure: g.sets[0]?.measure, kind: g.sets[0]?.kind };
            const sets = g.sets.map(s => blankSet({ weight: liftDisplay(s.weight_kg), reps: s.reps == null ? '' : String(s.reps), time: fmtHold(s.duration_s), side: s.side || null, warmup: s.warmup, rpe: s.rpe || null, done: true }));
            return entryFor({ ...def, name: g.name, measure: g.sets[0]?.measure || def.measure }, sets, g.sets.some(s => s.weight_kg));
          }) });
        location.hash = '#/train/active';
      } }, 'Edit'),
      h('button', { class: 'btn sm ghost danger', onclick: async () => {
        if (!(await confirmSheet('Delete workout?', `Delete ${w.name} from ${shortDate(w.date)}?`))) return;
        await post('workouts/delete', { id: w.id }); histCache.clear(); toast('Workout deleted'); location.hash = '#/train';
      } }, 'Delete')]),
    h('div', { class: 'stack', style: { maxWidth: '760px' } },
      h('div', { class: 'card', style: { display: 'grid', gridTemplateColumns: `repeat(${w.effort ? 4 : 3}, minmax(0, 1fr))` } },
        h('div', { class: 'stat' }, h('span', { class: 'num' }, w.set_count), h('span', { class: 'label' }, 'working sets')),
        w.effort ? h('div', { class: 'stat' }, h('span', { class: 'num' }, `${w.effort}/10`), h('span', { class: 'label' }, 'session effort')) : null,
        h('div', { class: 'stat' }, h('span', { class: 'num' }, fmt0(toDisplayW(w.volume_kg))), h('span', { class: 'label' }, `${wUnit()} volume`)),
        h('div', { class: 'stat' }, h('span', { class: 'num' }, groups.length), h('span', { class: 'label' }, 'exercises'))),
      ...groups.map(g => h('section', { class: 'card', 'aria-label': g.name },
        h('div', { class: 'card-head' }, h('h2', { style: { font: '600 18px var(--body)' } }, h('a', { href: `#/train/exercise/${g.exercise_id}`, style: { color: 'inherit' } }, g.name)),
          h('span', { class: 'small muted' }, (() => {
            if (g.sets[0]?.measure === 'time') { const b = Math.max(0, ...g.sets.map(s => s.duration_s || 0)); return b ? `Longest ${fmtHold(b)}` : ''; }
            const b = Math.max(0, ...g.sets.filter(s => !s.warmup).map(s => e1rm(s.weight_kg, s.reps) || 0)); return b ? `e1RM ${liftDisplay(b)} ${wUnit()}` : ''; })())),
        h('table', { class: 'table' }, h('tbody', null, (() => { let n = 0; return g.sets.map(s => h('tr', null,
          h('td', { class: 'muted', style: { width: '40px' } }, s.warmup ? 'W' : `${s.side === 'R' && n ? n : ++n}${s.side || ''}`),
          h('td', null, s.measure === 'time' || s.duration_s != null ? holdText(s)
            : `${s.weight_kg != null ? `${liftDisplay(s.weight_kg)} ${wUnit()}` : 'Bodyweight'} x ${s.reps ?? '-'}`),
          h('td', { class: 'r muted' }, s.rpe ? `Effort ${s.rpe}` : ''))); })())))),
      w.notes ? h('section', { class: 'card' }, h('h2', null, 'Notes'), h('p', { style: { whiteSpace: 'pre-wrap' } }, w.notes)) : null));
}

/* ---------- exercise history ---------- */

async function renderExercise(root, id) {
  root.replaceChildren(loading());
  histCache.delete(id);
  const [hist, exs] = await Promise.all([history(id), exercises()]);
  const ex = exs.find(e => e.id === id) || { name: 'Exercise' };
  if (isTimed(ex) || hist.some(x => x.sets.some(s => s.duration_s != null))) return renderTimedExercise(root, ex, hist);
  const sessions = [...hist].reverse();
  const best = sessions.map(s => Math.max(0, ...s.sets.filter(x => !x.warmup).map(x => e1rm(x.weight_kg, x.reps) || 0)) || null);
  root.replaceChildren(
    pageHead([ex.muscle, ex.equipment].filter(Boolean).join(', ') || 'Exercise', ex.name, [
      h('button', { class: 'btn sm ghost', onclick: () => editExercise(ex, () => { exercisesCache = null; location.hash = '#/train'; }) }, 'Edit')]),
    h('div', { class: 'row' },
      h('section', { class: 'card grow-3', 'aria-label': 'Estimated one-rep max' },
        h('h2', null, 'Estimated 1-rep max'),
        sessions.length > 1
          ? chart({ n: sessions.length, w: 640, h: 220, lines: [{ values: best.map(toDisplayW), color: 'var(--primary)', endDot: true }], dots: [{ values: best.map(toDisplayW), color: 'var(--primary)' }],
              xLabels: dateTicks(sessions.map(s => s.date), Math.min(4, sessions.length)), yFormat: fmt0, label: `Estimated one-rep max for ${ex.name} by session` })
          : h('p', { class: 'note' }, 'Log this exercise in two or more sessions to see a trend.'),
        h('p', { class: 'note small' }, 'Estimated from your best working set each session (Epley formula).')),
      h('section', { class: 'card grow-2', 'aria-label': 'Sessions' },
        h('h2', null, 'Sessions'),
        hist.length ? h('div', { class: 'list' }, hist.slice(0, 30).map(s => h('a', { class: 'list-row', href: `#/train/${s.workout_id}`, style: { textDecoration: 'none', color: 'inherit' } },
          h('div', { class: 'main' }, h('span', { class: 'title' }, relDay(s.date)),
            h('span', { class: 'small muted' }, s.sets.filter(x => !x.warmup).map(x => `${liftDisplay(x.weight_kg) || 'BW'}x${x.reps ?? '-'}`).join(', '))))))
          : h('p', { class: 'note' }, 'Not logged yet.'))));
}

/** History for an exercise held for time: longest hold, best session, time held lately, heaviest added weight. */
function renderTimedExercise(root, ex, hist) {
  const work = (x) => x.sets.filter(s => !s.warmup && s.duration_s);
  const sessions = [...hist].reverse().filter(x => work(x).length);
  const longest = sessions.map(x => Math.max(...work(x).map(s => s.duration_s)));
  const weighted = sessions.map(x => work(x).some(s => s.weight_kg));
  const total = (x) => work(x).reduce((a, s) => a + s.duration_s, 0);
  const all = hist.flatMap(work);
  const best = all.length ? Math.max(...all.map(s => s.duration_s)) : null;
  const bestSession = hist.length ? Math.max(0, ...hist.map(total)) : 0;
  const since = shiftDate(-30);
  const recent = hist.filter(x => x.date >= since).reduce((a, x) => a + total(x), 0);
  const heavy = all.filter(s => s.weight_kg).sort((a, b) => b.weight_kg - a.weight_kg || b.duration_s - a.duration_s)[0] || null;
  const stat = (v, l) => h('div', { class: 'stat' }, h('span', { class: 'num' }, v), h('span', { class: 'label' }, l));
  root.replaceChildren(
    pageHead([ex.muscle, ex.equipment].filter(Boolean).join(', ') || 'Exercise', ex.name, [
      ex.id ? h('button', { class: 'btn sm ghost', onclick: () => editExercise(ex, () => { exercisesCache = null; location.hash = '#/train'; }) }, 'Edit') : null]),
    h('div', { class: 'stack' },
      h('section', { class: 'card', 'aria-label': 'Records', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 8px' } },
        stat(best ? fmtHold(best) : '-', 'longest hold'),
        stat(bestSession ? fmtHold(bestSession) : '-', 'best session total'),
        stat(fmtHold(recent), 'held, last 30 days'),
        stat(heavy ? `+${liftDisplay(heavy.weight_kg)} ${wUnit()}` : '-', heavy ? `heaviest, held ${fmtHold(heavy.duration_s)}` : 'heaviest added weight')),
      h('div', { class: 'row' },
        h('section', { class: 'card grow-3', 'aria-label': 'Longest hold' },
          h('h2', null, 'Longest hold'),
          weighted.some(Boolean) && sessions.length > 1 ? h('p', { class: 'note small', style: { marginTop: '-4px' } }, 'Orange dots had added weight.') : null,
          sessions.length > 1
            ? chart({ n: sessions.length, w: 640, h: 220, lines: [{ values: longest, color: 'var(--primary)', endDot: !weighted.at(-1) }],
                dots: [{ values: longest.map((v, i) => (weighted[i] ? null : v)), color: 'var(--primary)' }, { values: longest.map((v, i) => (weighted[i] ? v : null)), color: '#FF914D', r: 5.5 }],
                xLabels: dateTicks(sessions.map(x => x.date), Math.min(4, sessions.length)), yFormat: (v) => fmtHold(v), yMin: 0,
                label: `Longest hold for ${ex.name} by session` })
            : h('p', { class: 'note' }, 'Log this exercise in two or more sessions to see a trend.')),
        h('section', { class: 'card grow-2', 'aria-label': 'Sessions' },
          h('h2', null, 'Sessions'),
          hist.length ? h('div', { class: 'list' }, hist.slice(0, 30).map(x => h('a', { class: 'list-row', href: `#/train/${x.workout_id}`, style: { textDecoration: 'none', color: 'inherit' } },
            h('div', { class: 'main' }, h('span', { class: 'title' }, relDay(x.date)),
              h('span', { class: 'small muted' }, work(x).map(s => `${s.side ? `${s.side} ` : ''}${holdText(s)}`).join(' · '))),
            h('span', { class: 'small muted' }, `${fmtHold(total(x))} total`))))
            : h('p', { class: 'note' }, 'Not logged yet.')))));
}

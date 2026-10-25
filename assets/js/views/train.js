import { h, icon, fmt0, fmt1, todayISO, relDay, shortDate, openSheet, toast, confirmSheet, debounce } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, wUnit, liftDisplay, fromDisplayW, toDisplayW } from '../store.js';
import { pageHead, loading } from '../components.js';
import { chart, dateTicks } from '../charts.js';

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
  const [a, b] = params;
  if (a === 'new') return startWorkout(root, new URLSearchParams(location.hash.split('?')[1] || '').get('routine'));
  if (a === 'active') return renderActive(root);
  if (a === 'exercise' && b) return renderExercise(root, +b);
  if (a && /^\d+$/.test(a)) return renderSaved(root, +a);
  return renderList(root);
}

/* ---------- list ---------- */

async function renderList(root) {
  const [routinesRes, wk, exs] = await Promise.all([get('routines'), get('workouts', { from: shiftDate(-90) }), exercises()]);
  const exName = Object.fromEntries(exs.map(e => [e.id, e.name]));
  const active = readActive();
  const items = [
    ...wk.workouts.map(w => ({ kind: 'lift', date: w.date, w })),
    ...wk.whoop.filter(x => !/strength|weightlifting|functional/i.test(x.sport || '')).map(x => ({ kind: 'whoop', date: x.date, x })),
  ].sort((p, q) => (p.date < q.date ? 1 : -1));
  const strainByDate = {};
  wk.whoop.forEach(x => { if (/strength|weightlifting|functional/i.test(x.sport || '')) strainByDate[x.date] = x.strain; });

  root.replaceChildren(
    pageHead('Training', 'Train', [h('a', { class: 'btn sm', href: '#/train/new' }, 'Empty workout')]),
    h('div', { class: 'stack' },
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
        h('section', { class: 'card grow-3', 'aria-label': 'History' },
          h('h2', null, 'Last 90 days'),
          items.length ? h('div', { class: 'list' }, items.map(it => it.kind === 'lift'
            ? h('a', { class: 'list-row', href: `#/train/${it.w.id}`, style: { textDecoration: 'none', color: 'inherit' } },
                h('div', { class: 'main' }, h('span', { class: 'title' }, it.w.name),
                  h('span', { class: 'small muted' }, `${relDay(it.w.date)}${it.w.duration_min ? `, ${it.w.duration_min} min` : ''}, ${it.w.set_count} sets, ${fmt0(toDisplayW(it.w.volume_kg))} ${wUnit()} volume`)),
                strainByDate[it.date] != null ? h('span', { class: 'small muted' }, `Strain ${fmt1(strainByDate[it.date])}`) : null)
            : h('div', { class: 'list-row' },
                h('div', { class: 'main' }, h('span', { class: 'title' }, it.x.sport), h('span', { class: 'small muted' }, `${relDay(it.x.date)}, from WHOOP${it.x.kcal ? `, ${fmt0(it.x.kcal)} kcal` : ''}`)),
                it.x.strain != null ? h('span', { class: 'small muted' }, `Strain ${fmt1(it.x.strain)}`) : null)))
            : h('p', { class: 'note' }, 'No sessions yet. Start a routine or an empty workout.'))),
      h('section', { class: 'card', 'aria-label': 'Exercises' },
        h('div', { class: 'card-head' }, h('h2', null, 'Exercises'), h('button', { class: 'btn sm ghost', onclick: () => editExercise(null, () => { exercisesCache = null; renderList(root); }) }, 'New exercise')),
        h('div', { class: 'pills' }, exs.map(e => h('a', { class: 'pill', href: `#/train/exercise/${e.id}`, style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none', color: 'inherit' } }, e.name))))));
}

function shiftDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

function editExercise(ex, onDone) {
  const s = openSheet({
    title: ex ? 'Edit exercise' : 'New exercise',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const r = await post('exercises/save', { id: ex?.id, name: f.querySelector('#ex-name').value, muscle: f.querySelector('#ex-m').value, equipment: f.querySelector('#ex-eq').value });
      s.close(); toast('Exercise saved'); onDone?.(r.exercise);
    } },
      h('label', { class: 'field', for: 'ex-name' }, 'Name', h('input', { id: 'ex-name', required: true, value: ex?.name || '' })),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field', for: 'ex-m' }, 'Muscle group', h('input', { id: 'ex-m', value: ex?.muscle || '' })),
        h('label', { class: 'field', for: 'ex-eq' }, 'Equipment', h('input', { id: 'ex-eq', value: ex?.equipment || '' }))),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save exercise'),
      ex ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet('Delete exercise?', 'It disappears from pickers. Past workouts keep it.'))) return;
        await post('exercises/delete', { id: ex.id }); s.close(); onDone?.(null);
      } }, 'Delete exercise') : null),
  });
}

function editRoutine(r, exs, onDone) {
  const chosen = [...(r?.exercise_ids || [])];
  openSheet({
    title: r ? 'Edit routine' : 'New routine',
    tall: true,
    body: (sheet) => {
      const nameIn = h('input', { id: 'rt-name', value: r?.name || '', required: true });
      const list = h('div', { class: 'list' });
      const byId = Object.fromEntries(exs.map(e => [e.id, e]));
      const draw = () => list.replaceChildren(...chosen.map((id, i) => h('div', { class: 'list-row' },
        h('span', { class: 'title' }, byId[id]?.name || 'Exercise'),
        h('div', null,
          h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [chosen[i - 1], chosen[i]] = [chosen[i], chosen[i - 1]]; draw(); } }, icon('left')),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { chosen.splice(i, 1); draw(); } }, icon('close'))))));
      draw();
      sheet.body.append(
        h('label', { class: 'field', for: 'rt-name' }, 'Name', nameIn),
        list,
        h('button', { class: 'btn block', onclick: () => pickExercise((ex) => { chosen.push(ex.id); draw(); }) }, 'Add exercise'),
        h('button', { class: 'btn primary block', onclick: async () => {
          if (!nameIn.value.trim()) { toast('Name the routine', 'error'); return; }
          await post('routines/save', { id: r?.id, name: nameIn.value, exercise_ids: chosen });
          sheet.close(); toast('Routine saved'); onDone?.();
        } }, 'Save routine'),
        r ? h('button', { class: 'btn block danger', onclick: async () => {
          if (!(await confirmSheet('Delete routine?', `Delete ${r.name}? Past workouts aren't affected.`))) return;
          await post('routines/delete', { id: r.id }); sheet.close(); onDone?.();
        } }, 'Delete routine') : null);
    },
  });
}

function pickExercise(onPick) {
  openSheet({
    title: 'Add exercise',
    tall: true,
    body: async (sheet) => {
      const all = await exercises();
      const q = h('input', { type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises' });
      const list = h('div', { class: 'list' });
      const draw = () => {
        const t = q.value.trim().toLowerCase();
        const hits = all.filter(e => !t || e.name.toLowerCase().includes(t) || (e.muscle || '').toLowerCase().includes(t));
        list.replaceChildren(...hits.map(e => h('button', { class: 'list-row', onclick: () => { sheet.close(); onPick(e); } },
          h('div', { class: 'main' }, h('span', { class: 'title' }, e.name), h('span', { class: 'small muted' }, [e.muscle, e.equipment].filter(Boolean).join(', '))))),
          h('button', { class: 'btn block', style: { marginTop: '8px' }, onclick: () => { sheet.close(); editExercise(null, async (ex) => { await exercises(true); if (ex) onPick(ex); }); } }, `Create a new exercise`));
      };
      q.addEventListener('input', draw);
      sheet.body.append(h('label', { class: 'search' }, icon('search'), q), list);
      draw();
      q.focus();
    },
  });
}

/* ---------- active workout ---------- */

async function startWorkout(root, routineId) {
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
  if (routineId) {
    const r = (await get('routines')).routines.find(x => x.id === +routineId);
    if (r) { name = r.name; ids = r.exercise_ids.filter(id => byId[id]); }
  }
  const entries = await Promise.all(ids.map(async id => {
    const hist = await history(id);
    const last = hist[0]?.sets || [];
    const working = last.filter(s => !s.warmup);
    const n = Math.max(3, working.length);
    return { exercise_id: id, name: byId[id].name, sets: Array.from({ length: n }, () => ({ weight: '', reps: '', warmup: false, done: false })) };
  }));
  writeActive({ name, date: todayISO(), started_at: Date.now(), exercises: entries });
  location.hash = '#/train/active';
}

let restTimer = null;
let restEnds = 0;

function renderActive(root) {
  const w = readActive();
  if (!w) { location.hash = '#/train'; return; }
  const save = () => writeActive(w);
  const restSecs = state.settings?.rest_seconds || 120;

  const minutes = () => Math.max(1, Math.round((Date.now() - w.started_at) / 60000));
  const elapsed = h('span', { class: 'eyebrow' }, `In progress, ${minutes()} min`);
  const nameBtn = h('button', { style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit' }, 'aria-label': `Rename workout, currently ${w.name}`, onclick: () => {
    const s = openSheet({ title: 'Rename workout', body: h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); w.name = e.target.querySelector('input').value || w.name; save(); s.close(); renderActive(root); } },
      h('input', { class: 'input', value: w.name, 'aria-label': 'Workout name' }), h('button', { class: 'btn primary block', type: 'submit' }, 'Save')) });
  } }, h('h1', null, w.name));

  const restBox = h('div', { class: 'rest', hidden: true, role: 'timer', 'aria-live': 'off' });
  const drawRest = () => {
    const left = Math.round((restEnds - Date.now()) / 1000);
    if (left <= 0) {
      restBox.hidden = true; clearInterval(restTimer); restTimer = null;
      if (restEnds) { navigator.vibrate?.([200, 100, 200]); restEnds = 0; }
      return;
    }
    restBox.hidden = false;
    restBox.replaceChildren(
      h('span', { style: { display: 'flex', flexDirection: 'column' } }, h('span', { class: 'small', style: { color: 'var(--on-deep-muted)' } }, 'Rest'),
        h('span', { class: 'num', style: { fontSize: '30px' } }, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`)),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button', { class: 'btn sm', onclick: () => { restEnds -= 15000; drawRest(); } }, '-15 s'),
        h('button', { class: 'btn sm', onclick: () => { restEnds += 15000; drawRest(); } }, '+15 s'),
        h('button', { class: 'btn sm light', onclick: () => { restEnds = Date.now(); drawRest(); } }, 'Skip')));
  };
  const startRest = () => { restEnds = Date.now() + restSecs * 1000; clearInterval(restTimer); restTimer = setInterval(drawRest, 1000); drawRest(); };
  if (restEnds > Date.now()) { clearInterval(restTimer); restTimer = setInterval(drawRest, 1000); drawRest(); }

  const cards = h('div', { class: 'stack' });
  const drawCards = () => cards.replaceChildren(...w.exercises.map((ex, xi) => exerciseCard(ex, xi)));

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
    const rows = ex.sets.map((s, si) => {
      const label = s.warmup ? 'W' : String(++wNum);
      const lastCell = h('span', { class: 'small muted' }, '-');
      lastCells[si] = lastCell;
      const wIn = h('input', { class: 'w-in', inputmode: 'decimal', value: s.weight, placeholder: s._phW || '', 'aria-label': `Set ${label} weight in ${wUnit()}` });
      const rIn = h('input', { class: 'r-in', inputmode: 'numeric', value: s.reps, placeholder: s._phR ?? '', 'aria-label': `Set ${label} reps` });
      wIn.addEventListener('input', () => { s.weight = wIn.value; save(); });
      rIn.addEventListener('input', () => { s.reps = rIn.value; save(); });
      return h('div', { class: 'set-grid set-row' + (s.done ? ' done' : '') },
        h('button', { class: 'set-n', 'aria-label': `Set ${label} options`, onclick: () => setMenu(ex, si) }, label),
        lastCell, wIn, rIn,
        h('button', { class: 'done-btn', 'aria-pressed': String(!!s.done), 'aria-label': s.done ? `Set ${label} done` : `Mark set ${label} done`, onclick: () => {
          if (!s.done) {
            if (!s.weight && s._phW) s.weight = s._phW;
            if (!s.reps && s._phR != null) s.reps = String(s._phR);
            if (!s.reps) { toast('Enter reps first', 'error'); return; }
          }
          s.done = !s.done; save(); drawCards();
          if (s.done) startRest();
        } }, icon('check')));
    });
    card.append(
      h('div', { class: 'card-head' },
        h('h2', { style: { font: '600 18px var(--body)' } }, ex.name),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, best,
          h('button', { class: 'icon-btn', 'aria-label': `Options for ${ex.name}`, onclick: () => exerciseMenu(xi) }, icon('more')))),
      h('div', { class: 'set-grid head' }, h('span', null, 'Set'), h('span', null, 'Last time'), h('span', null, wUnit()), h('span', null, 'Reps'), h('span', { style: { textAlign: 'center' } }, 'Done')),
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
      h('button', { class: 'btn block danger', onclick: () => { ex.sets.splice(si, 1); save(); sh.close(); drawCards(); } }, 'Delete set')) });
  };
  const exerciseMenu = (xi) => {
    const ex = w.exercises[xi];
    const sh = openSheet({ title: ex.name, body: h('div', { class: 'stack' },
      h('a', { class: 'btn block', href: `#/train/exercise/${ex.exercise_id}`, onclick: () => sh.close() }, 'History and progress'),
      xi > 0 ? h('button', { class: 'btn block', onclick: () => { w.exercises.splice(xi - 1, 0, w.exercises.splice(xi, 1)[0]); save(); sh.close(); drawCards(); } }, 'Move up') : null,
      h('button', { class: 'btn block', onclick: () => { sh.close(); pickExercise((n) => { w.exercises[xi] = { exercise_id: n.id, name: n.name, sets: ex.sets.map(s => ({ ...s, done: false })) }; save(); drawCards(); }); } }, 'Replace exercise'),
      h('button', { class: 'btn block danger', onclick: () => { w.exercises.splice(xi, 1); save(); sh.close(); drawCards(); } }, 'Remove exercise')) });
  };

  const finish = async () => {
    const sets = [];
    w.exercises.forEach((ex) => ex.sets.forEach((s) => {
      const reps = parseInt(s.reps || '', 10);
      if (!s.done && !reps) return;
      sets.push({ exercise_id: ex.exercise_id, position: sets.length, reps: reps || null, weight_kg: s.weight !== '' ? fromDisplayW(String(s.weight).replace(',', '.')) : null, warmup: s.warmup });
    }));
    if (!sets.length) {
      if (await confirmSheet('Nothing logged', 'No sets have reps yet. Discard this workout?', 'Discard')) { writeActive(null); location.hash = '#/train'; }
      return;
    }
    try {
      const r = await post('workouts/save', { id: w.id, date: w.date, name: w.name, notes: w.notes || null, duration_min: w.duration_min || minutes(), sets });
      writeActive(null); histCache.clear(); restEnds = 0;
      toast(r.queued ? 'Workout saved offline. It will sync when you reconnect.' : 'Workout saved');
      location.hash = r.queued ? '#/train' : `#/train/${r.workout.id}`;
    } catch (e) { toast(e.message, 'error'); }
  };

  drawCards();
  root.replaceChildren(
    h('header', { class: 'page-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, elapsed, nameBtn),
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmSheet('Discard workout?', 'Everything logged in this session will be lost.', 'Discard')) { writeActive(null); location.hash = '#/train'; } } }, 'Discard'),
        h('button', { class: 'btn sm primary', onclick: finish }, 'Finish'))),
    h('div', { class: 'stack', style: { maxWidth: '760px' } },
      restBox,
      cards,
      h('button', { class: 'btn block', onclick: () => pickExercise((ex) => { w.exercises.push({ exercise_id: ex.id, name: ex.name, sets: [0, 1, 2].map(() => ({ weight: '', reps: '', warmup: false, done: false })) }); save(); drawCards(); }) }, 'Add exercise'),
      h('label', { class: 'field' }, 'Notes', h('textarea', { oninput: (e) => { w.notes = e.target.value; save(); } }, w.notes || ''))));

  const tick = setInterval(() => { elapsed.textContent = `In progress, ${minutes()} min`; }, 30000);
  return () => { clearInterval(tick); clearInterval(restTimer); restTimer = null; };
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
      h('button', { class: 'btn sm', onclick: () => {
        if (readActive()) { toast('Finish or discard the workout in progress first', 'error'); return; }
        writeActive({ id: w.id, name: w.name, date: w.date, notes: w.notes, duration_min: w.duration_min, started_at: Date.now(),
          exercises: groups.map(g => ({ exercise_id: g.exercise_id, name: g.name, sets: g.sets.map(s => ({ weight: liftDisplay(s.weight_kg), reps: s.reps == null ? '' : String(s.reps), warmup: s.warmup, done: true })) })) });
        location.hash = '#/train/active';
      } }, 'Edit'),
      h('button', { class: 'btn sm ghost danger', onclick: async () => {
        if (!(await confirmSheet('Delete workout?', `Delete ${w.name} from ${shortDate(w.date)}?`))) return;
        await post('workouts/delete', { id: w.id }); histCache.clear(); toast('Workout deleted'); location.hash = '#/train';
      } }, 'Delete')]),
    h('div', { class: 'stack', style: { maxWidth: '760px' } },
      h('div', { class: 'card', style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } },
        h('div', { class: 'stat' }, h('span', { class: 'num' }, w.set_count), h('span', { class: 'label' }, 'working sets')),
        h('div', { class: 'stat' }, h('span', { class: 'num' }, fmt0(toDisplayW(w.volume_kg))), h('span', { class: 'label' }, `${wUnit()} volume`)),
        h('div', { class: 'stat' }, h('span', { class: 'num' }, groups.length), h('span', { class: 'label' }, 'exercises'))),
      ...groups.map(g => h('section', { class: 'card', 'aria-label': g.name },
        h('div', { class: 'card-head' }, h('h2', { style: { font: '600 18px var(--body)' } }, h('a', { href: `#/train/exercise/${g.exercise_id}`, style: { color: 'inherit' } }, g.name)),
          h('span', { class: 'small muted' }, (() => { const b = Math.max(0, ...g.sets.filter(s => !s.warmup).map(s => e1rm(s.weight_kg, s.reps) || 0)); return b ? `e1RM ${liftDisplay(b)} ${wUnit()}` : ''; })())),
        h('table', { class: 'table' }, h('tbody', null, (() => { let n = 0; return g.sets.map(s => h('tr', null,
          h('td', { class: 'muted', style: { width: '40px' } }, s.warmup ? 'W' : String(++n)),
          h('td', null, `${s.weight_kg != null ? `${liftDisplay(s.weight_kg)} ${wUnit()}` : 'Bodyweight'} x ${s.reps ?? '-'}`),
          h('td', { class: 'r muted' }, s.rpe ? `RPE ${s.rpe}` : ''))); })())))),
      w.notes ? h('section', { class: 'card' }, h('h2', null, 'Notes'), h('p', { style: { whiteSpace: 'pre-wrap' } }, w.notes)) : null));
}

/* ---------- exercise history ---------- */

async function renderExercise(root, id) {
  root.replaceChildren(loading());
  histCache.delete(id);
  const [hist, exs] = await Promise.all([history(id), exercises()]);
  const ex = exs.find(e => e.id === id) || { name: 'Exercise' };
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

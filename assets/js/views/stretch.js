// Stretching: routines and the stretch library (Train > Stretch), their editors, and the guided timer.
import { h, icon, fmt0, todayISO, relDay, openSheet, toast, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary } from '../store.js';
import { pageHead, loading } from '../components.js';
import { addDays } from '../tdee.js';
import { gripHandle, makeSortable } from '../sortable.js';
import { trainSwitch, ACTIVITIES } from './cardio.js';
import { playTone, alarmSettings, unlockAudio } from '../restalarm.js';

let areaFilter = 'All';
const mins = (s) => Math.max(1, Math.round(s / 60));
export const holdText = (s, hold = s.hold_s) => (s.reps ? `${s.reps} reps` : `${hold} s`) + (s.per_side ? ' each side' : '');

export async function render(root, params = []) {
  if (params[0] === 'run' && params[1]) return renderRun(root, +params[1]);
  root.replaceChildren(loading());
  await loadSummary();
  const [data, rt, hb] = await Promise.all([get('stretch'), get('routines'), get('habits', { date: todayISO(), days: 7 }).catch(() => null)]);
  const refresh = () => render(root);
  const byId = Object.fromEntries(data.stretches.map(s => [s.id, s]));
  const routineName = Object.fromEntries(rt.routines.map(r => [r.id, r.name]));

  const mob = hb?.habits.find(x => x.kind === 'mobility');
  const weekCard = h('section', { class: 'card', 'aria-label': 'This week' },
    h('div', { class: 'grid-3' },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '30px', color: 'var(--green)' } }, data.week.sessions), h('span', { class: 'label' }, `session${data.week.sessions === 1 ? '' : 's'} this week`)),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '30px' } }, data.week.minutes), h('span', { class: 'label' }, 'minutes')),
      mob ? h('a', { class: 'stat linkish', href: '#/habits' }, h('span', { class: 'num', style: { fontSize: '30px' } }, mob.streak), h('span', { class: 'label' }, `day streak, ${mob.name.toLowerCase()} habit${mob.done ? '' : ' (not yet today)'}`))
        : h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '30px' } }, data.recent[0] ? relDay(data.recent[0].date) : '-'), h('span', { class: 'label' }, 'last session'))));

  const attachText = (r) => {
    if (!r.attach.length) return null;
    const when = r.attach[0].when === 'after' ? 'Cool-down for' : 'Warm-up for';
    const names = r.attach.map(a => (a.type === 'routine' ? routineName[a.id] : `${a.activity.toLowerCase()}s`)).filter(Boolean);
    return names.length ? `${when} ${names.join(', ')}` : null;
  };
  const routinesCard = h('section', { class: 'card', 'aria-label': 'Routines', style: { gap: 0 } },
    h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, 'Routines'),
      h('button', { class: 'btn sm ghost', onclick: () => editRoutine(null, data, rt.routines, refresh) }, 'New routine')),
    data.routines.length ? h('div', { class: 'list' }, data.routines.map(r => h('div', { class: 'list-row' },
      h('button', { class: 'main linkish', style: { background: 'none', border: 0, padding: 0, textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }, 'aria-label': `Edit ${r.name}`, onclick: () => editRoutine(r, data, rt.routines, refresh) },
        h('span', { class: 'title' }, r.name),
        h('span', { class: 'small muted' }, `${r.items.length} stretch${r.items.length === 1 ? '' : 'es'}, about ${mins(r.est_s)} min`),
        attachText(r) ? h('span', { class: 'tiny', style: { color: 'var(--primary)', fontWeight: 600 } }, attachText(r)) : null),
      h('a', { class: 'btn sm', href: `#/train/stretch/run/${r.id}` }, 'Start'))))
      : h('p', { class: 'note' }, 'Build a routine from the library below, then start it for a guided timer.'));

  const areas = ['All', ...data.areas.filter(a => data.stretches.some(s => s.area === a))];
  const libList = h('div', { class: 'list' });
  const drawLib = () => libList.replaceChildren(...data.stretches.filter(s => areaFilter === 'All' || s.area === areaFilter).map(s =>
    h('button', { class: 'list-row', onclick: () => editStretch(s, data.areas, refresh) },
      h('div', { class: 'main' }, h('span', { class: 'title' }, s.name), h('span', { class: 'small muted' }, `${s.area} · ${holdText(s)}`)),
      s.custom ? h('span', { class: 'tiny muted' }, 'Added by you') : null)));
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Body area' });
  const drawChips = () => chips.replaceChildren(...areas.map(a => h('button', { class: 'chip', role: 'radio', 'aria-checked': String(areaFilter === a), onclick: () => { areaFilter = a; drawChips(); drawLib(); } }, a)));
  drawChips(); drawLib();
  const libCard = h('section', { class: 'card', 'aria-label': 'Stretch library' },
    h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, 'Library'),
      h('button', { class: 'btn sm ghost', onclick: () => editStretch(null, data.areas, refresh) }, 'Add a stretch')),
    chips, libList);

  const recentCard = data.recent.length ? h('section', { class: 'card', 'aria-label': 'Recent sessions', style: { gap: 0 } }, h('h2', null, 'Recent sessions'),
    h('div', { class: 'list' }, data.recent.slice(0, 5).map(x => h('div', { class: 'list-row' },
      h('div', { class: 'main' }, h('span', { class: 'title' }, x.name), h('span', { class: 'small muted' }, `${relDay(x.date)}, ${mins(x.duration_s)} min${x.stretches ? `, ${x.stretches} stretches` : ''}`)),
      h('button', { class: 'icon-btn', 'aria-label': `Delete ${x.name} on ${relDay(x.date)}`, onclick: async () => {
        if (!(await confirmSheet('Delete session?', `Delete ${x.name} from ${relDay(x.date).toLowerCase()}?`))) return;
        await post('stretch/sessions/delete', { id: x.id }); refresh();
      } }, icon('trash', 18)))))) : null;

  root.replaceChildren(
    pageHead('Training', 'Stretching', [h('button', { class: 'btn sm primary', onclick: () => editRoutine(null, data, rt.routines, refresh) }, 'New routine')]),
    h('div', { class: 'stack' },
      trainSwitch('stretch'),
      h('div', { class: 'row' },
        h('div', { class: 'grow-3 stack' }, weekCard, routinesCard, recentCard),
        h('div', { class: 'grow-2 stack' }, libCard))));
}

function editStretch(s, areas, onDone) {
  const nameIn = h('input', { id: 'st-name', required: true, value: s?.name || '' });
  const areaSel = h('select', { id: 'st-area' }, areas.map(a => h('option', { value: a, selected: (s?.area || 'Hips') === a }, a)));
  const holdIn = h('input', { id: 'st-hold', inputmode: 'numeric', value: s?.hold_s ?? 30 });
  const repsIn = h('input', { id: 'st-reps', inputmode: 'numeric', value: s?.reps ?? '', placeholder: 'Leave blank to hold' });
  const sideIn = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: 'st-side', checked: !!s?.per_side });
  const cueIn = h('textarea', { id: 'st-cue', rows: 2, placeholder: 'A short cue shown during the timer' }, s?.cue || '');
  const sh = openSheet({
    title: s ? 'Edit stretch' : 'Add a stretch',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      await post('stretch/save', { id: s?.id, name: nameIn.value, area: areaSel.value, hold_s: +holdIn.value || 30, reps: repsIn.value ? +repsIn.value : null, per_side: sideIn.checked, cue: cueIn.value.trim() || null });
      sh.close(); toast('Stretch saved'); onDone?.();
    } },
      h('label', { class: 'field', for: 'st-name' }, 'Name', nameIn),
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'st-area' }, 'Body area', areaSel), h('label', { class: 'field', for: 'st-hold' }, 'Hold or work time (seconds)', holdIn)),
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'st-reps' }, 'Reps (for drills)', repsIn),
        h('label', { class: 'set-row-line', for: 'st-side', style: { borderTop: 0 } }, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Each side'), h('span', { class: 'small muted' }, 'Runs twice, switching sides')), sideIn)),
      h('label', { class: 'field', for: 'st-cue' }, 'Cue', cueIn),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save stretch'),
      s ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet('Delete stretch?', `${s.name} comes out of the library and any routines that use it.`))) return;
        await post('stretch/delete', { id: s.id }); sh.close(); onDone?.();
      } }, 'Delete stretch') : null),
  });
}

function editRoutine(r, data, routines, onDone) {
  const byId = Object.fromEntries(data.stretches.map(s => [s.id, s]));
  const items = (r?.items || []).map(it => ({ ...it }));
  let when = r?.attach?.[0]?.when || 'none';
  if (!r?.attach?.length) when = 'none';
  const attached = new Set((r?.attach || []).map(a => (a.type === 'routine' ? `r:${a.id}` : `c:${a.activity}`)));
  openSheet({
    title: r ? 'Edit stretching routine' : 'New stretching routine',
    tall: true,
    body: (sheet) => {
      const nameIn = h('input', { id: 'sr-name', value: r?.name || '', required: true });
      const list = h('div', { class: 'list' });
      const total = h('span', { class: 'small muted' });
      const draw = () => {
        list.replaceChildren(...items.map((it, i) => {
          const s = byId[it.stretch_id];
          return h('div', { class: 'list-row sort-row', 'data-key': String(i), 'data-label': s.name },
            gripHandle(s.name),
            h('div', { class: 'main' }, h('span', { class: 'title' }, s.name), h('span', { class: 'small muted' }, `${s.area} · ${holdText(s, it.hold_s)}`)),
            h('input', { class: 'hold-in', inputmode: 'numeric', value: it.hold_s ?? s.hold_s, 'aria-label': `${s.name} seconds`, oninput: (e) => { it.hold_s = +e.target.value || s.hold_s; drawTotal(); } }),
            h('span', { class: 'tiny muted' }, 's'),
            h('button', { class: 'icon-btn', 'aria-label': `Remove ${s.name}`, onclick: () => { items.splice(i, 1); draw(); } }, icon('close', 18)));
        }));
        drawTotal();
      };
      const drawTotal = () => {
        const sec = items.reduce((a, it) => { const s = byId[it.stretch_id]; return a + (it.hold_s ?? s.hold_s) * (s.per_side ? 2 : 1) + 5; }, 0);
        total.textContent = items.length ? `${items.length} stretch${items.length === 1 ? '' : 'es'}, about ${mins(sec)} min` : 'No stretches yet';
      };
      makeSortable(list, { onChange: (keys) => { const next = keys.map(k => items[+k]); items.splice(0, items.length, ...next); draw(); } });
      draw();

      const whenBox = h('div', { class: 'segmented big', role: 'radiogroup', 'aria-label': 'Use as' });
      const forBox = h('div', { class: 'stack', style: { gap: '8px' } });
      const drawAttach = () => {
        whenBox.replaceChildren(...[['none', 'On its own'], ['before', 'Warm-up'], ['after', 'Cool-down']].map(([k, l]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(when === k), onclick: () => { when = k; drawAttach(); } }, l)));
        forBox.hidden = when === 'none';
        const chip = (key, label) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(attached.has(key)), onclick: () => { attached.has(key) ? attached.delete(key) : attached.add(key); drawAttach(); } }, label);
        forBox.replaceChildren(
          routines.length ? h('div', { class: 'field' }, h('span', { class: 'chip-label' }, 'Strength routines'), h('div', { class: 'chips' }, routines.map(x => chip(`r:${x.id}`, x.name)))) : null,
          h('div', { class: 'field' }, h('span', { class: 'chip-label' }, 'Cardio'), h('div', { class: 'chips' }, ACTIVITIES.filter(a => a !== 'Other').map(a => chip(`c:${a}`, a)))));
      };
      drawAttach();

      sheet.body.append(
        h('label', { class: 'field', for: 'sr-name' }, 'Name', nameIn),
        h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('span', { style: { fontWeight: 600 } }, 'Stretches'), total),
        list,
        h('button', { class: 'btn block', onclick: () => pickStretch(data, (s) => { items.push({ stretch_id: s.id, hold_s: s.hold_s }); draw(); }) }, 'Add a stretch'),
        h('div', { class: 'field' }, h('span', null, 'Use as'), whenBox, h('span', { class: 'tiny muted', style: { fontWeight: 400 } }, 'A warm-up is offered before those sessions start, a cool-down after you finish them.')),
        forBox,
        h('button', { class: 'btn primary block', onclick: async () => {
          if (!nameIn.value.trim()) { toast('Name the routine', 'error'); return; }
          if (!items.length) { toast('Add at least one stretch', 'error'); return; }
          const attach = when === 'none' ? [] : [...attached].map(k => (k.startsWith('r:') ? { type: 'routine', id: +k.slice(2), when } : { type: 'cardio', activity: k.slice(2), when }));
          try {
            await post('stretch/routines/save', { id: r?.id, name: nameIn.value, items, attach });
            sheet.close(); toast('Routine saved'); onDone?.();
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Save routine'),
        r ? h('button', { class: 'btn block danger', onclick: async () => {
          if (!(await confirmSheet('Delete routine?', `Delete ${r.name}? Sessions you've logged stay, and it comes off your schedule.`))) return;
          await post('stretch/routines/delete', { id: r.id }); sheet.close(); onDone?.();
        } }, 'Delete routine') : null);
    },
  });
}

function pickStretch(data, onPick) {
  let area = 'All';
  openSheet({
    title: 'Add a stretch',
    tall: true,
    body: (sheet) => {
      const list = h('div', { class: 'list' });
      const chips = h('div', { class: 'chips' });
      const draw = () => {
        chips.replaceChildren(...['All', ...data.areas].map(a => h('button', { class: 'chip', 'aria-pressed': String(area === a), onclick: () => { area = a; draw(); } }, a)));
        list.replaceChildren(...data.stretches.filter(s => area === 'All' || s.area === area).map(s => h('button', { class: 'list-row', onclick: () => { sheet.close(); onPick(s); } },
          h('div', { class: 'main' }, h('span', { class: 'title' }, s.name), h('span', { class: 'small muted' }, `${s.area} · ${holdText(s)}`)),
          h('span', { class: 'add-ic', 'aria-hidden': 'true' }, icon('plus', 20)))));
      };
      draw();
      sheet.body.append(chips, list);
    },
  });
}

/* ---------- guided timer ---------- */

const MUTE_KEY = 'ff_stretch_muted';
let wakeLock = null;

async function renderRun(root, id) {
  root.replaceChildren(loading());
  const data = await get('stretch');
  const r = data.routines.find(x => x.id === id);
  if (!r) { location.hash = '#/train/stretch'; return; }
  const byId = Object.fromEntries(data.stretches.map(s => [s.id, s]));
  const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next');

  // The steps: each hold (and the other side), with a short change between them.
  const steps = [];
  r.items.forEach((it, i) => {
    const s = byId[it.stretch_id];
    const hold = it.hold_s ?? s.hold_s;
    if (i > 0) steps.push({ kind: 'change', secs: 5, s, idx: i });
    if (s.per_side) {
      steps.push({ kind: 'hold', secs: hold, s, side: 'Right side', idx: i });
      steps.push({ kind: 'change', secs: 5, s, idx: i, switchSide: true });
      steps.push({ kind: 'hold', secs: hold, s, side: 'Left side', idx: i });
    } else steps.push({ kind: 'hold', secs: hold, s, idx: i });
  });
  let k = 0, endsAt = 0, pausedLeft = null, startedAt = Date.now(), timer = null, finished = false;
  let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();
  const sound = () => { if (!muted && alarmSettings().sound) playTone(steps[k]?.kind === 'hold' ? 'chime' : 'beeps', alarmSettings().volume); navigator.vibrate?.(150); };

  const wrap = h('div', { class: 'stretch-run' });
  root.replaceChildren(wrap);
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }

  const begin = (i) => { k = i; endsAt = Date.now() + steps[k].secs * 1000; pausedLeft = null; drawStep(); };
  const advance = (ring = true) => {
    if (k >= steps.length - 1) { complete(); return; }
    begin(k + 1);
    if (ring) sound();
  };
  const stretchesDone = () => new Set(steps.slice(0, k + (finished ? 1 : 0)).filter(x => x.kind === 'hold').map(x => x.idx)).size;
  const log = async (count) => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    try { await post('stretch/log', { date: todayISO(), routine_id: r.id, duration_s: secs, stretches: count }); state.stale = true; } catch (e) { toast(e.message, 'error'); }
    return secs;
  };
  const complete = async () => {
    finished = true; clearInterval(timer);
    sound();
    const secs = await log(r.items.length);
    wrap.replaceChildren(h('div', { class: 'run-done' },
      h('span', { class: 'eyebrow-orange' }, 'Done'),
      h('h1', null, r.name),
      h('p', null, `${mins(secs)} min, ${r.items.length} stretch${r.items.length === 1 ? '' : 'es'}. Logged for today.`),
      next ? h('a', { class: 'btn kcal block', href: next }, 'Continue') : null,
      h('a', { class: next ? 'btn outline-light block' : 'btn kcal block', href: '#/train/stretch' }, next ? 'Back to stretching' : 'Done')));
  };
  const end = async () => {
    clearInterval(timer);
    const done = stretchesDone();
    if (done && await confirmSheet('End early?', `Log the ${done} stretch${done === 1 ? '' : 'es'} you finished?`, 'Log and end')) { await log(done); toast('Logged'); }
    else if (!done && !(await confirmSheet('End stretching?', 'Nothing has been logged yet.', 'End'))) { timer = setInterval(tick, 250); return; }
    location.hash = next || '#/train/stretch';
  };

  // Built once; each tick only updates the countdown, so buttons never move under your finger.
  const ringBox = h('div', { class: 'run-ring' });
  const numB = h('b'), numSub = h('span');
  const titleB = h('b'), segs = h('div', { class: 'run-segs', role: 'img' });
  const nameH = h('h1'), sideTag = h('span', { class: 'run-side' }), cueP = h('p', { class: 'run-cue' }), nextB = h('b');
  const muteBtn = h('button', { class: 'icon-btn run-mute', onclick: () => { muted = !muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {} drawStep(); } });
  const backBtn = h('button', { class: 'btn outline-light', onclick: () => begin(Math.max(0, k - 1)) }, 'Back');
  const pauseBtn = h('button', { class: 'btn light', onclick: () => {
    if (pausedLeft != null) { endsAt = Date.now() + pausedLeft * 1000; pausedLeft = null; } else { pausedLeft = Math.max(0, (endsAt - Date.now()) / 1000); }
    drawStep();
  } });
  const C = 2 * Math.PI * 110;
  const arc = (() => { const svg = svgRing(C, 1, false); ringBox.append(svg, h('span', { class: 'run-num' }, numB, numSub)); return svg.lastChild; })();
  wrap.replaceChildren(
    h('div', { class: 'run-top' },
      h('button', { class: 'btn outline-light', onclick: end }, 'End'),
      h('span', { class: 'run-title' }, h('span', { class: 'tiny' }, r.name), titleB),
      muteBtn),
    segs,
    h('div', { class: 'run-name' }, nameH, sideTag),
    ringBox, cueP,
    h('div', { class: 'run-next' }, h('span', { class: 'tiny' }, 'Up next'), nextB),
    h('div', { class: 'run-ctl' }, backBtn, pauseBtn, h('button', { class: 'btn outline-light', onclick: () => advance(false) }, 'Skip')));

  const drawStep = () => {
    if (finished) return;
    const st = steps[k];
    titleB.textContent = `Stretch ${st.idx + 1} of ${r.items.length}`;
    segs.setAttribute('aria-label', `${st.idx} of ${r.items.length} stretches done`);
    segs.replaceChildren(...r.items.map((_, i) => h('span', { class: i < st.idx ? 'done' : i === st.idx ? 'now' : '' })));
    nameH.textContent = st.kind === 'change' && !st.switchSide ? `Next: ${st.s.name}` : st.s.name;
    const tag = st.kind === 'hold' ? (st.side || (st.s.reps ? `${st.s.reps} reps` : '')) : st.switchSide ? 'Switch sides' : '';
    sideTag.textContent = tag; sideTag.hidden = !tag;
    cueP.textContent = st.s.cue || ''; cueP.hidden = !st.s.cue;
    const upcoming = steps.slice(k + 1).find(x => x.kind === 'hold');
    nextB.textContent = upcoming ? (upcoming.idx === st.idx ? `${upcoming.side}, then ${steps.slice(k + 1).find(x => x.kind === 'hold' && x.idx !== st.idx)?.s.name || 'done'}` : upcoming.s.name) : 'Last one';
    muteBtn.replaceChildren(icon(muted ? 'muted' : 'sound', 20));
    muteBtn.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on'); muteBtn.setAttribute('aria-pressed', String(!muted));
    backBtn.disabled = k === 0;
    pauseBtn.textContent = pausedLeft != null ? 'Resume' : 'Pause';
    arc.setAttribute('stroke', st.kind === 'change' ? '#B8C6DC' : '#FF914D');
    numSub.textContent = st.kind === 'change' ? (st.switchSide ? 'switch sides' : 'get ready') : `of ${fmtClock(st.secs)}${st.s.reps ? '' : ' hold'}`;
    draw();
  };
  const draw = () => {
    if (finished) return;
    const st = steps[k];
    const left = pausedLeft ?? Math.max(0, (endsAt - Date.now()) / 1000);
    numB.textContent = fmtClock(Math.ceil(left));
    arc.setAttribute('stroke-dashoffset', (C * (1 - (st.secs ? left / st.secs : 0))).toFixed(1));
  };
  const tick = () => { if (pausedLeft == null && !finished && Date.now() >= endsAt) advance(); else draw(); };
  unlockAudio();
  begin(0);
  timer = setInterval(tick, 250);
  const onVis = async () => { if (document.visibilityState === 'visible' && !finished) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} } };
  document.addEventListener('visibilitychange', onVis);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); try { wakeLock?.release(); } catch {} wakeLock = null; };
}

const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
function svgRing(C, frac, change) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 250 250'); svg.setAttribute('aria-hidden', 'true');
  const c = (stroke, extra = {}) => { const e = document.createElementNS(ns, 'circle'); Object.entries({ cx: 125, cy: 125, r: 110, fill: 'none', 'stroke-width': 14, stroke, ...extra }).forEach(([a, v]) => e.setAttribute(a, v)); return e; };
  svg.append(c('rgba(255,255,255,0.14)'), c(change ? '#B8C6DC' : '#FF914D', { 'stroke-linecap': 'round', 'stroke-dasharray': C.toFixed(1), 'stroke-dashoffset': (C * (1 - frac)).toFixed(1), transform: 'rotate(-90 125 125)' }));
  return svg;
}

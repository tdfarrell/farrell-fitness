// Training: Cardio (logged here or from WHOOP) and Progress (totals, records, charts).
import { h, icon, fmt0, fmt1, todayISO, relDay, shortDate, toast, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, imperial, wUnit, toDisplayW, liftDisplay } from '../store.js';
import { pageHead, loading } from '../components.js';
import { chart, dateTicks } from '../charts.js';

export const ACTIVITIES = ['Run', 'Walk', 'Bike', 'Jump rope', 'Row', 'Swim', 'Hike', 'Elliptical', 'Stairs', 'Other'];
const ICON = { Run: 'run', Walk: 'walk', Bike: 'bike', 'Jump rope': 'rope', Row: 'row', Swim: 'swim', Hike: 'hike', Stairs: 'stairs' };
const DISTANCE = new Set(['Run', 'Walk', 'Bike', 'Row', 'Swim', 'Hike']);
const SPEED = new Set(['Bike']);
const MI = 1609.344, FT = 0.3048;
const ZONE_COLORS = ['var(--rule)', 'var(--soft-primary)', 'var(--sleep-light)', 'var(--primary)', 'var(--yellow)', 'var(--red)'];

/* ---------- formatting ---------- */
export const distUnit = () => (imperial() ? 'mi' : 'km');
export const toDist = (m) => (m == null ? null : imperial() ? m / MI : m / 1000);
export const fromDist = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : imperial() ? +v * MI : +v * 1000);
export function fmtDist(m) {
  if (m == null) return '-';
  const d = toDist(m);
  let t = d >= 100 ? String(Math.round(d)) : d.toFixed(d >= 10 ? 1 : 2);
  if (t.includes('.')) t = t.replace(/\.?0+$/, '');
  return `${t} ${distUnit()}`;
}
export function fmtDur(s) {
  if (s == null) return '-';
  s = Math.round(s);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export function fmtHours(s) {
  if (!s) return '0 min';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
/** Pace (min per mi/km) or speed (mph/kmh) as text. */
export function fmtPace(activity, distM, durS) {
  if (!distM || !durS) return null;
  const d = toDist(distM);
  if (SPEED.has(activity)) return `${fmt1(d / (durS / 3600))} ${imperial() ? 'mph' : 'km/h'}`;
  const secPer = Math.round(durS / d);
  return `${Math.floor(secPer / 60)}:${String(secPer % 60).padStart(2, '0')}/${distUnit()}`;
}
const actIcon = (a) => icon(ICON[a] || 'pulse');

export function trainSwitch(current) {
  return h('nav', { class: 'segmented big four', 'aria-label': 'Training sections' },
    h('a', { href: '#/train', 'aria-current': current === 'overview' ? 'page' : null }, 'Overview'),
    h('a', { href: '#/train/strength', 'aria-current': current === 'strength' ? 'page' : null }, 'Strength'),
    h('a', { href: '#/train/cardio', 'aria-current': current === 'cardio' ? 'page' : null }, 'Cardio'),
    h('a', { href: '#/train/progress', 'aria-current': current === 'progress' ? 'page' : null }, 'Progress'));
}

function sessionTitle(s) {
  if (s.distance_m && DISTANCE.has(s.activity)) return `${s.activity}, ${fmtDist(s.distance_m)}`;
  if (s.reps) return `${s.activity}, ${fmt0(s.reps)} skips`;
  if (s.duration_s) return `${s.activity}, ${fmtHours(s.duration_s)}`;
  return s.activity;
}
function sessionMeta(s) {
  return [relDay(s.date), s.duration_s && (s.distance_m || s.reps) ? fmtDur(s.duration_s) : null, fmtPace(s.activity, s.distance_m, s.duration_s),
    s.avg_hr ? `avg HR ${s.avg_hr}` : null, s.strain != null ? `strain ${fmt1(s.strain)}` : null].filter(Boolean).join(', ');
}
function zonesBar(z) {
  const total = z?.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const label = z.map((v, i) => (v ? `zone ${i} ${Math.round(v / 60)} min` : null)).filter(Boolean).join(', ');
  return h('div', { class: 'zones', role: 'img', 'aria-label': `Heart rate zones: ${label}` }, z.map((v, i) => (v ? h('div', { style: { flex: v, background: ZONE_COLORS[i] } }) : null)));
}

/* ---------- cardio list ---------- */

export async function renderCardio(root) {
  await loadSummary();
  const from = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  const { sessions } = await get('cardio', { from });
  const today = todayISO();
  const weekStart = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const thisWeek = weekStart(today);
  const wk = sessions.filter(s => s.date >= thisWeek);
  const weeks = [];
  for (let k = 7; k >= 0; k--) { const d = new Date(thisWeek + 'T12:00:00'); d.setDate(d.getDate() - k * 7); weeks.push(d.toISOString().slice(0, 10)); }
  const byWeek = weeks.map(w => sessions.filter(s => weekStart(s.date) === w).reduce((a, s) => a + (s.distance_m || 0), 0));
  const missing = sessions.filter(s => s.whoop_id && !s.distance_m && DISTANCE.has(s.activity) && s.date >= weeks[6]);

  const row = (s) => h('a', { class: 'cardio-row', href: s.id ? `#/train/cardio/${s.id}` : `#/train/cardio/whoop/${encodeURIComponent(s.whoop_id)}` },
    h('span', { class: 'act-ic', 'aria-hidden': 'true' }, actIcon(s.activity)),
    h('span', { class: 'main' },
      h('span', { class: 'title' }, sessionTitle(s)),
      h('span', { class: 'small muted' }, sessionMeta(s)),
      zonesBar(s.zones)),
    h('span', { class: 'badge' + (s.whoop_id ? ' dark' : '') }, s.whoop_id ? 'WHOOP' : 'Logged'));

  root.replaceChildren(
    pageHead('Training', 'Train', [h('a', { class: 'btn sm primary', href: '#/train/cardio/new' }, icon('plus', 18), 'Log cardio')]),
    h('div', { class: 'stack' },
      trainSwitch('cardio'),
      h('div', { class: 'row' },
        h('section', { class: 'card grow-2', 'aria-label': 'This week' },
          h('div', { class: 'grid-3' },
            h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '34px', color: 'var(--kcal)' } }, toDist(wk.reduce((a, s) => a + (s.distance_m || 0), 0)).toFixed(1)), h('span', { class: 'label' }, `${distUnit()} this week`)),
            h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '34px' } }, fmtDur(wk.reduce((a, s) => a + (s.duration_s || 0), 0)).replace(/:\d\d$/, '')), h('span', { class: 'label' }, 'hours')),
            h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '34px' } }, wk.length), h('span', { class: 'label' }, wk.length === 1 ? 'session' : 'sessions'))),
          h('span', { class: 'small muted', style: { fontWeight: 500 } }, `${distUnit() === 'mi' ? 'Miles' : 'Kilometers'} per week, last 8 weeks`),
          chart({ n: 8, w: 520, h: 150, yMin: 0, bars: [{ values: byWeek.map(toDist), colorFn: (v, i) => (i === 7 ? 'var(--kcal)' : 'var(--soft-primary)') }],
            xLabels: dateTicks(weeks, 3), yFormat: (v) => fmt0(v), label: `Distance per week for 8 weeks: ${byWeek.map(m => toDist(m).toFixed(1)).join(', ')} ${distUnit()}` })),
        h('div', { class: 'grow-3 stack' },
          missing.length ? h('a', { class: 'callout', href: missing[0].id ? `#/train/cardio/${missing[0].id}` : `#/train/cardio/whoop/${encodeURIComponent(missing[0].whoop_id)}` },
            h('span', { class: 'main' },
              h('span', { class: 'title' }, missing.length === 1
                ? `${relDay(missing[0].date)}'s WHOOP ${missing[0].activity.toLowerCase()} has no distance`
                : `${missing.length} WHOOP workouts from the last two weeks have no distance`),
              h('span', { class: 'small muted' }, 'Add it so it counts toward totals and records. Indoor sessions can stay as they are.')),
            h('span', { class: 'title' }, 'Add')) : null,
          h('section', { class: 'card', 'aria-label': 'Recent cardio', style: { gap: 0 } },
            h('h2', { style: { marginBottom: '6px' } }, 'Last 4 months'),
            sessions.length ? h('div', { class: 'list' }, sessions.slice(0, 60).map(row))
              : h('p', { class: 'note' }, 'Log a run, walk, ride or jump rope session, or connect WHOOP and your workouts show up here on their own.'))))));
}

/* ---------- cardio form ---------- */

function parseDur(txt) {
  const p = String(txt || '').trim().split(':').map(x => parseFloat(x));
  if (!p.length || p.some(Number.isNaN)) return null;
  const s = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60;
  return s > 0 ? Math.round(s) : null;
}

export async function renderCardioForm(root, { id = null, whoopId = null } = {}) {
  root.replaceChildren(loading());
  await loadSummary();
  let s = { date: todayISO(), activity: 'Run', start_time: '', duration_s: null, distance_m: null, avg_hr: null, max_hr: null, elevation_m: null, effort: null, kcal: null, reps: null, notes: '', whoop_id: null };
  let whoop = null;
  const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  if (id) s = { ...s, ...(await get('cardio/get', { id })).session };
  const near = (await get('cardio', { from })).sessions;
  if (whoopId) {
    whoop = near.find(x => x.whoop_id === whoopId);
    if (!whoop) { const all = (await get('cardio', { from: '2000-01-01' })).sessions; whoop = all.find(x => x.whoop_id === whoopId); }
    if (whoop?.id) { location.hash = `#/train/cardio/${whoop.id}`; return; }
    if (whoop) s = { ...s, ...whoop, id: null };
  } else if (s.whoop_id) whoop = s;

  let activity = ACTIVITIES.includes(s.activity) ? s.activity : 'Other';
  const actBox = h('div', { class: 'act-grid', role: 'radiogroup', 'aria-label': 'Activity' });
  const drawActs = () => actBox.replaceChildren(...ACTIVITIES.map(a => h('button', { type: 'button', role: 'radio', 'aria-checked': String(a === activity), onclick: () => { activity = a; drawActs(); syncFields(); } }, a)));
  drawActs();

  const inp = (id, value, attrs = {}) => h('input', { id, value: value ?? '', ...attrs });
  const fld = (label, el, cls) => h('label', { class: 'field' + (cls ? ' ' + cls : ''), for: el.id }, label, el);
  const dateIn = inp('cd-date', s.date, { type: 'date', max: todayISO() });
  const timeIn = inp('cd-time', s.start_time || '', { type: 'time' });
  const durIn = inp('cd-dur', s.duration_s ? fmtDur(s.duration_s) : '', { inputmode: 'numeric', placeholder: 'h:mm:ss or mm:ss' });
  const distIn = inp('cd-dist', s.distance_m ? +toDist(s.distance_m).toFixed(2) : '', { inputmode: 'decimal' });
  const repsIn = inp('cd-reps', s.reps ?? '', { inputmode: 'numeric' });
  const hrIn = inp('cd-hr', s.avg_hr ?? '', { inputmode: 'numeric' });
  const maxIn = inp('cd-max', s.max_hr ?? '', { inputmode: 'numeric' });
  const elevIn = inp('cd-elev', s.elevation_m != null ? Math.round(imperial() ? s.elevation_m / FT : s.elevation_m) : '', { inputmode: 'numeric', placeholder: 'Optional' });
  const effIn = inp('cd-eff', s.effort ?? '', { inputmode: 'numeric', placeholder: 'Optional' });
  const kcalIn = inp('cd-kcal', s.kcal != null ? Math.round(s.kcal) : '', { inputmode: 'numeric', placeholder: 'Optional' });
  const notesIn = h('textarea', { id: 'cd-notes', rows: 2, placeholder: 'Route, conditions, how it felt' }, s.notes || '');
  const pace = h('span', { class: 'num', style: { fontSize: '24px' } }, '-');
  const paceLabel = h('span', { class: 'small muted' });
  const distField = fld(`Distance (${distUnit()})`, distIn);
  const repsField = fld('Skips (optional)', repsIn);
  const paceBox = h('div', { class: 'pace-box' }, paceLabel, pace);
  const syncFields = () => {
    distField.hidden = !(DISTANCE.has(activity) || activity === 'Other' || activity === 'Elliptical' || activity === 'Stairs');
    repsField.hidden = activity !== 'Jump rope';
    const p = fmtPace(activity, fromDist(distIn.value.replace(',', '.')), parseDur(durIn.value));
    paceLabel.textContent = SPEED.has(activity) ? 'Average speed' : 'Average pace';
    pace.textContent = p || '-';
    paceBox.hidden = distField.hidden;
  };
  [durIn, distIn].forEach(el => el.addEventListener('input', syncFields));
  syncFields();

  // WHOOP workouts on the same day that aren't linked to anything yet.
  const linkBox = h('section', { class: 'card dark', 'aria-label': 'WHOOP workout' });
  let linkId = s.whoop_id || null;
  const drawLink = () => {
    const w = linkId ? (whoop?.whoop_id === linkId ? whoop : near.find(x => x.whoop_id === linkId)) : null;
    const options = near.filter(x => x.source === 'whoop' && x.date === dateIn.value);
    linkBox.replaceChildren(
      h('div', { class: 'card-head' }, h('h2', null, 'WHOOP workout'),
        linkId ? h('button', { class: 'btn sm', type: 'button', style: { background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }, onclick: () => { linkId = null; drawLink(); } }, 'Unlink') : null),
      w ? h('p', { class: 'note' }, `${w.sport || w.activity}, ${w.start_time || ''}${w.duration_s ? `, ${fmtHours(w.duration_s)}` : ''}. Strain, heart rate zones and calories come from WHOOP; what you enter here fills the gaps.`)
        : options.length ? h('div', { class: 'stack' },
            h('p', { class: 'note' }, 'Link a WHOOP workout from this day to merge its strain, heart rate and calories with what you log.'),
            ...options.map(o => h('button', { class: 'btn sm', type: 'button', style: { justifyContent: 'flex-start' }, onclick: () => { linkId = o.whoop_id; whoop = o; drawLink(); } },
              `${o.sport || o.activity}, ${o.start_time || ''}${o.duration_s ? `, ${fmtHours(o.duration_s)}` : ''}`)))
          : h('p', { class: 'note' }, 'No unlinked WHOOP workouts on this day.'),
      w ? h('div', { class: 'grid-3' },
        h('div', { class: 'stat' }, h('span', { class: 'num' }, w.strain != null ? fmt1(w.strain) : '-'), h('span', { class: 'label' }, 'strain')),
        h('div', { class: 'stat' }, h('span', { class: 'num' }, w.max_hr ?? '-'), h('span', { class: 'label' }, 'max HR')),
        h('div', { class: 'stat' }, h('span', { class: 'num' }, w.kcal != null ? fmt0(w.kcal) : '-'), h('span', { class: 'label' }, 'kcal'))) : null,
      w ? zonesBar(w.zones) : null);
  };
  dateIn.addEventListener('change', drawLink);
  drawLink();

  const save = async () => {
    const dur = parseDur(durIn.value);
    if (durIn.value.trim() && !dur) { toast('Enter the time as h:mm:ss or mm:ss', 'error'); durIn.focus(); return; }
    const num = (el) => { const v = parseFloat(String(el.value).replace(',', '.')); return Number.isNaN(v) ? null : v; };
    const body = {
      id: s.id || null, date: dateIn.value, start_time: timeIn.value || null, activity,
      duration_s: dur, distance_m: distField.hidden ? null : fromDist(num(distIn)), reps: repsField.hidden ? null : num(repsIn),
      avg_hr: num(hrIn), max_hr: num(maxIn), elevation_m: num(elevIn) == null ? null : imperial() ? num(elevIn) * FT : num(elevIn),
      effort: num(effIn), kcal: num(kcalIn), notes: notesIn.value.trim() || null, whoop_id: linkId,
    };
    if (!body.duration_s && !body.distance_m && !body.whoop_id) { toast('Enter a time or a distance', 'error'); return; }
    try {
      const r = await post('cardio/save', body);
      toast(r.queued ? 'Saved offline. It will sync when you reconnect.' : 'Session saved');
      location.hash = '#/train/cardio';
    } catch (e) { toast(e.message, 'error'); }
  };

  root.replaceChildren(
    pageHead(whoopId ? 'Add details to a WHOOP workout' : s.id ? shortDate(s.date) : 'Cardio', s.id ? 'Edit session' : 'Log cardio', [
      h('a', { class: 'btn sm ghost', href: '#/train/cardio' }, 'Cancel'),
      h('button', { class: 'btn sm primary', onclick: save }, 'Save')]),
    h('div', { class: 'stack', style: { maxWidth: '760px' } },
      h('section', { class: 'card', 'aria-label': 'Activity' }, h('h2', null, 'Activity'), actBox),
      h('section', { class: 'card', 'aria-label': 'Details' },
        h('div', { class: 'grid-2' }, fld('Date', dateIn), fld('Start time', timeIn)),
        h('div', { class: 'grid-2' }, fld('Time', durIn), distField),
        paceBox, repsField,
        h('div', { class: 'form-grid' }, fld('Avg HR', hrIn), fld('Max HR', maxIn), fld(`Elevation gain (${imperial() ? 'ft' : 'm'})`, elevIn), fld('Effort, 1 to 10', effIn), fld('Calories', kcalIn)),
        fld('Notes', notesIn)),
      linkBox,
      h('button', { class: 'btn primary block', onclick: save }, 'Save session'),
      s.id ? h('button', { class: 'btn block danger', onclick: async () => {
        if (!(await confirmSheet('Delete session?', `Delete this ${s.activity.toLowerCase()} from ${shortDate(s.date)}?${s.whoop_id ? ' The WHOOP workout stays.' : ''}`))) return;
        await post('cardio/delete', { id: s.id }); toast('Session deleted'); location.hash = '#/train/cardio';
      } }, 'Delete session') : null));
}

/* ---------- progress ---------- */

let progRange = 365;
let progChart = 'weekly_distance';

export async function renderProgress(root) {
  root.replaceChildren(loading());
  await loadSummary();
  const from = progRange >= 99999 ? '2000-01-01' : new Date(Date.now() - progRange * 86400000).toISOString().slice(0, 10);
  const [st, meas] = await Promise.all([get('training/stats', { from }), get('measurements', { kind: 'vo2max' }).catch(() => ({ measurements: [] }))]);
  const { summary } = state;

  const rangeTabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Range', style: { maxWidth: '280px' } },
    [[90, '3M'], [365, '1Y'], [99999, 'All']].map(([d, l]) => h('button', { role: 'tab', 'aria-selected': String(progRange === d), onclick: () => { progRange = d; renderProgress(root); } }, l)));

  const total = (v, unit, label, color) => h('div', { class: 'stat' },
    h('span', { class: 'num', style: { fontSize: '32px', color: color || 'inherit' } }, v, unit ? h('span', { class: 'unit' }, ` ${unit}`) : null), h('span', { class: 'label', style: { fontSize: '13px' } }, label));
  const vol = toDisplayW(st.strength.volume_kg);
  const totals = h('section', { class: 'card', 'aria-label': 'Totals' },
    h('div', { class: 'card-head' }, h('h2', null, 'Totals'), rangeTabs),
    h('div', { class: 'grid-2 totals-grid' },
      total(fmt0(toDist(st.cardio.distance_m)), distUnit(), 'run, walk, ride and more', 'var(--kcal)'),
      total(fmt0(st.cardio.duration_s / 3600), 'h', 'cardio time'),
      total(vol >= 1e6 ? `${(vol / 1e6).toFixed(2)}M` : fmt0(vol), wUnit(), 'total weight lifted'),
      total(fmt0(st.strength.workouts + st.cardio.sessions), '', `workouts (${st.strength.workouts} lifting, ${st.cardio.sessions} cardio)`)),
    st.cardio.by_activity.length ? h('div', { class: 'list' }, st.cardio.by_activity.map(a => h('div', { class: 'list-row' },
      h('span', { class: 'act-ic sm', 'aria-hidden': 'true' }, actIcon(a.activity)),
      h('div', { class: 'main' }, h('span', { class: 'title' }, a.activity), h('span', { class: 'small muted' }, `${a.sessions} session${a.sessions === 1 ? '' : 's'}, ${fmtHours(a.duration_s)}`)),
      a.distance_m ? h('span', { style: { fontWeight: 600 } }, fmtDist(a.distance_m)) : null))) : null);

  // Chart picker.
  const exOpts = st.exercises.filter(e => e.sessions >= 2).slice(0, 30);
  const chartBox = h('div');
  const sel = h('select', { class: 'input', id: 'pg-chart', style: { width: 'auto', height: '40px' } },
    h('option', { value: 'weekly_distance', selected: progChart === 'weekly_distance' }, `Weekly distance (${distUnit()})`),
    h('option', { value: 'weekly_time', selected: progChart === 'weekly_time' }, 'Weekly cardio time'),
    h('option', { value: 'weekly_volume', selected: progChart === 'weekly_volume' }, `Weekly weight lifted (${wUnit()})`),
    ...exOpts.map(e => h('option', { value: `ex:${e.exercise_id}`, selected: progChart === `ex:${e.exercise_id}` }, `${e.name}, estimated 1-rep max`)));
  const drawChart = async () => {
    progChart = sel.value;
    // Skip the empty weeks before your first logged training, but always show at least 12 weeks.
    const inRange = st.weeks.filter(w => w.week >= from || w.week >= st.weeks[Math.max(0, st.weeks.length - 12)].week);
    const firstActive = inRange.findIndex(w => w.distance_m || w.duration_s || w.volume_kg);
    const wk = inRange.slice(Math.max(0, Math.min(firstActive < 0 ? 0 : firstActive, inRange.length - 12)));
    const ticks = dateTicks(wk.map(w => w.week), 4);
    if (progChart === 'weekly_distance') chartBox.replaceChildren(chart({ n: wk.length, w: 640, h: 220, yMin: 0, bars: [{ values: wk.map(w => toDist(w.distance_m)), color: 'var(--kcal)' }], xLabels: ticks, yFormat: fmt0, label: `Weekly distance in ${distUnit()}` }));
    else if (progChart === 'weekly_time') chartBox.replaceChildren(chart({ n: wk.length, w: 640, h: 220, yMin: 0, bars: [{ values: wk.map(w => w.duration_s / 3600), color: 'var(--primary)' }], xLabels: ticks, yFormat: (v) => `${fmt1(v).replace('.0', '')}h`, label: 'Weekly cardio time in hours' }));
    else if (progChart === 'weekly_volume') chartBox.replaceChildren(chart({ n: wk.length, w: 640, h: 220, yMin: 0, bars: [{ values: wk.map(w => toDisplayW(w.volume_kg)), color: 'var(--primary)' }], xLabels: ticks, yFormat: (v) => (v >= 1000 ? `${fmt0(v / 1000)}k` : fmt0(v)), label: `Weekly weight lifted in ${wUnit()}` }));
    else {
      const id = +progChart.slice(3);
      chartBox.replaceChildren(loading());
      const hist = [...(await get('exercises/history', { id })).history].reverse().filter(x => x.date >= from);
      const best = hist.map(x => Math.max(0, ...x.sets.filter(s => !s.warmup).map(s => (s.weight_kg && s.reps ? s.weight_kg * (1 + Math.min(s.reps, 12) / 30) : 0))) || null);
      let run = 0;
      const prs = best.map(v => (v && v > run + 1e-9 ? (run = v, toDisplayW(v)) : null));
      const ex = st.exercises.find(e => e.exercise_id === id);
      chartBox.replaceChildren(hist.length > 1
        ? chart({ n: hist.length, w: 640, h: 220, lines: [{ values: best.map(toDisplayW), color: 'var(--primary)', endDot: true }], dots: [{ values: prs, color: 'var(--kcal)', r: 5 }],
            xLabels: dateTicks(hist.map(x => x.date), Math.min(4, hist.length)), yFormat: fmt0, label: `Estimated one-rep max for ${ex?.name} by session, with personal records marked` })
        : h('p', { class: 'note' }, 'Not enough sessions in this range.'),
        hist.length > 1 ? h('div', { class: 'legend' }, h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '5px', background: 'var(--kcal)' } }), 'New personal record')) : null);
    }
  };
  sel.addEventListener('change', drawChart);
  const chartCard = h('section', { class: 'card grow-3', 'aria-label': 'Progress chart' },
    h('div', { class: 'card-head' }, h('h2', null, 'Trend'), h('label', { class: 'sr', for: 'pg-chart' }, 'Chart'), sel), chartBox);
  drawChart();

  // Records.
  const rec = (name, when, val, href) => h(href ? 'a' : 'div', { class: 'list-row', href, style: href ? { textDecoration: 'none', color: 'inherit' } : null },
    h('div', { class: 'main' }, h('span', { class: 'title' }, name), h('span', { class: 'small muted' }, when)),
    h('span', { class: 'num', style: { fontSize: '22px' } }, val));
  const strengthRecs = st.exercises.filter(e => e.best_e1rm_kg).slice(0, 12).map(e =>
    rec(e.name, `${shortDate(e.best_e1rm_date)}, ${liftDisplay(e.best_e1rm_set.weight_kg)} x ${e.best_e1rm_set.reps}. Heaviest ${liftDisplay(e.heaviest_kg)} ${wUnit()} x ${e.heaviest_reps}`, `${liftDisplay(e.best_e1rm_kg)} ${wUnit()}`, `#/train/exercise/${e.exercise_id}`));
  const cardioRecs = st.cardio_records.flatMap(a => [
    a.longest_distance ? rec(`Longest ${a.activity.toLowerCase()}`, shortDate(a.longest_distance.date), fmtDist(a.longest_distance.distance_m)) : null,
    a.best_pace ? rec(`Best ${SPEED.has(a.activity) ? 'speed' : 'pace'}, ${a.activity.toLowerCase()}`, `${shortDate(a.best_pace.date)}, ${fmtDist(a.best_pace.distance_m)} in ${fmtDur(a.best_pace.duration_s)}`, fmtPace(a.activity, a.best_pace.distance_m, a.best_pace.duration_s)) : null,
    a.longest_time && !a.longest_distance ? rec(`Longest ${a.activity.toLowerCase()}`, shortDate(a.longest_time.date), fmtHours(a.longest_time.duration_s)) : null,
    a.most_reps ? rec(`Most skips, ${a.activity.toLowerCase()}`, shortDate(a.most_reps.date), fmt0(a.most_reps.reps)) : null,
  ].filter(Boolean));

  // Fitness markers from Health and WHOOP.
  const days = summary.days;
  const recent = (k, n = 30) => days.slice(-n).map(d => d.whoop?.[k]).filter(v => v != null);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const vo2 = meas.measurements;
  const markers = h('section', { class: 'card grow-2', 'aria-label': 'Fitness markers' },
    h('div', { class: 'card-head' }, h('h2', null, 'Fitness markers'), h('a', { class: 'small', href: '#/health' }, 'Health')),
    h('div', { class: 'grid-3' },
      h('div', { class: 'stat' }, h('span', { class: 'num' }, vo2.length ? fmt0(vo2[vo2.length - 1].value) : '-'), h('span', { class: 'label' }, 'VO2 max')),
      h('div', { class: 'stat' }, h('span', { class: 'num' }, fmt0(avg(recent('rhr')))), h('span', { class: 'label' }, 'resting HR, 30-day avg')),
      h('div', { class: 'stat' }, h('span', { class: 'num' }, fmt0(avg(recent('hrv')))), h('span', { class: 'label' }, 'HRV, 30-day avg'))),
    vo2.length > 1 ? chart({ n: vo2.length, w: 400, h: 140, lines: [{ values: vo2.map(m => m.value), color: 'var(--kcal)', endDot: true }], dots: [{ values: vo2.map(m => m.value), color: 'var(--kcal)' }],
      xLabels: dateTicks(vo2.map(m => m.date), Math.min(3, vo2.length)), yFormat: fmt0, label: 'VO2 max over time' })
      : h('p', { class: 'note small' }, 'Add your VO2 max from the WHOOP app on the Health screen to chart it here.'));

  root.replaceChildren(
    pageHead('Training', 'Train'),
    h('div', { class: 'stack' },
      trainSwitch('progress'),
      h('div', { class: 'row' }, h('div', { class: 'grow-2 stack' }, totals), chartCard),
      h('div', { class: 'row' },
        h('section', { class: 'card grow-3', 'aria-label': 'Strength records' }, h('h2', null, 'Strength records'),
          strengthRecs.length ? h('div', { class: 'list' }, strengthRecs) : h('p', { class: 'note' }, 'Log workouts to see your best lifts here.'),
          h('p', { class: 'note small' }, 'Estimated 1-rep max from your best working set (Epley formula).')),
        h('div', { class: 'grow-2 stack' },
          h('section', { class: 'card', 'aria-label': 'Cardio records' }, h('h2', null, 'Cardio records'),
            cardioRecs.length ? h('div', { class: 'list' }, cardioRecs) : h('p', { class: 'note' }, 'Log cardio with a distance to see your longest and fastest sessions.'),
            h('p', { class: 'note small' }, 'Best pace counts sessions of at least 1 km (0.6 mi).')),
          markers))));
}

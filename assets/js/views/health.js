// Health: vitals and fitness markers, sleep, medications and supplements, labs and blood sugar.
import { h, icon, fmt0, fmt1, todayISO, relDay, shortDate, hoursMin, openSheet, toast, confirmSheet, relDayLc } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, fmtW, wUnit, toDisplayW, imperial } from '../store.js';
import { pageHead, loading } from '../components.js';
import { chart, dateTicks } from '../charts.js';
import { gripHandle, makeSortable } from '../sortable.js';

const TIMES = [['morning', 'Morning'], ['midday', 'Midday'], ['evening', 'Evening'], ['bedtime', 'Bedtime'], ['any', 'Any time']];
const TIME_LABEL = Object.fromEntries(TIMES);
const CONTEXTS = [['fasting', 'Fasting'], ['before_meal', 'Before a meal'], ['after_meal_1h', '1 h after a meal'], ['after_meal_2h', '2 h after a meal'], ['bedtime', 'Bedtime'], ['other', 'Other']];
const CONTEXT_LABEL = Object.fromEntries(CONTEXTS);
const avg = (a) => { const v = a.filter(x => x != null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
const nowHHMM = () => new Date().toTimeString().slice(0, 5);

// Starting points for common markers (US units). Labs differ, so they're editable and the report wins.
export const LAB_PRESETS = [
  ['Total cholesterol', 'mg/dL', null, 199], ['LDL cholesterol', 'mg/dL', null, 99], ['HDL cholesterol', 'mg/dL', 40, null], ['Triglycerides', 'mg/dL', null, 149],
  ['ApoB', 'mg/dL', null, 90], ['Glucose, fasting', 'mg/dL', 70, 99], ['HbA1c', '%', 4.0, 5.6], ['Insulin, fasting', 'uIU/mL', 2.6, 24.9],
  ['Vitamin D, 25-OH', 'ng/mL', 30, 100], ['TSH', 'mIU/L', 0.45, 4.5], ['Testosterone, total', 'ng/dL', 264, 916], ['Ferritin', 'ng/mL', 30, 400],
  ['hs-CRP', 'mg/L', null, 3], ['ALT', 'U/L', null, 44], ['AST', 'U/L', null, 40], ['Creatinine', 'mg/dL', 0.76, 1.27], ['eGFR', 'mL/min', 60, null],
  ['Hemoglobin', 'g/dL', 13.0, 17.7], ['Hematocrit', '%', 37.5, 51], ['Vitamin B12', 'pg/mL', 232, 1245], ['PSA', 'ng/mL', null, 4],
];

export async function render(root, params) {
  if (params[0] === 'labs') return renderLabs(root);
  if (params[0] === 'meds') return renderMeds(root);
  root.replaceChildren(loading());
  await loadSummary();
  const data = await get('health', { date: todayISO() });
  const { summary, model } = state;
  const days = summary.days;
  const W = (k, from, to) => days.slice(from, to).map(d => d.whoop?.[k] ?? null);
  const refresh = () => render(root, params);

  // 7-day average now against the 30 days before it.
  const vital = (k) => {
    const now = avg(W(k, -7)), base = avg(W(k, -37, -7));
    return { now, delta: now != null && base != null ? now - base : null };
  };
  const tile = (label, value, unit, delta, goodWhen, fmt = fmt0) => {
    const d = delta == null ? null : Math.abs(delta) < (fmt === fmt0 ? 0.5 : 0.05) ? 'steady' : `${delta > 0 ? 'up' : 'down'} ${fmt(Math.abs(delta))}`;
    const good = delta == null || goodWhen == null || d === 'steady' ? null : (goodWhen === 'up') === (delta > 0);
    return h('div', { class: 'stat' },
      h('span', { class: 'num', style: { fontSize: '26px' } }, value == null ? '-' : fmt(value), unit ? h('span', { class: 'unit' }, unit) : null),
      h('span', { class: 'label' }, label),
      d ? h('span', { class: 'tiny', style: { fontWeight: 600, color: good == null ? 'var(--muted)' : good ? 'var(--green)' : 'var(--red)' } }, d) : null);
  };
  const vo2 = data.measurements.filter(m => m.kind === 'vo2max');
  const bp = data.measurements.filter(m => m.kind === 'bp').pop();
  const lastVo2 = vo2[vo2.length - 1];
  const vo2Change = vo2.length > 1 ? lastVo2.value - vo2[Math.max(0, vo2.length - 2)].value : null;
  const rhr = vital('rhr'), hrv = vital('hrv'), spo2 = vital('spo2'), resp = vital('resp_rate'), skin = vital('skin_temp'), steps = vital('step_count');

  const vitals = h('section', { class: 'card', 'aria-label': 'Fitness and vitals' },
    h('div', { class: 'card-head' }, h('h2', null, 'Fitness and vitals'), h('span', { class: 'small muted' }, '7-day average vs the 30 days before')),
    h('div', { class: 'vo2-tile' },
      h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, gap: '2px' } },
        h('span', { class: 'small', style: { color: 'var(--on-deep-muted)' } }, 'VO2 max'),
        h('span', { class: 'num', style: { fontSize: '40px' } }, lastVo2 ? fmt0(lastVo2.value) : '-', h('span', { class: 'unit' }, ' ml/kg/min')),
        h('span', { class: 'small', style: { color: 'var(--on-deep-muted)' } }, lastVo2
          ? `${vo2Change ? `${vo2Change > 0 ? 'Up' : 'Down'} ${fmt0(Math.abs(vo2Change))} since the last entry. ` : ''}Entered ${shortDate(lastVo2.date)}.`
          : "WHOOP doesn't share VO2 max with other apps. Copy it from the WHOOP app now and then.")),
      h('button', { class: 'btn sm light', onclick: () => openMeasurementSheet('vo2max', refresh) }, lastVo2 ? 'Update' : 'Add')),
    vo2.length > 1 ? chart({ n: vo2.length, w: 640, h: 120, lines: [{ values: vo2.map(m => m.value), color: 'var(--kcal)', endDot: true }], dots: [{ values: vo2.map(m => m.value), color: 'var(--kcal)' }],
      xLabels: dateTicks(vo2.map(m => m.date), Math.min(3, vo2.length)), yFormat: fmt0, label: `VO2 max from ${vo2[0].value} to ${lastVo2.value}` }) : null,
    h('div', { class: 'grid-3 vitals-grid' },
      tile('Resting HR', rhr.now, ' bpm', rhr.delta, 'down'),
      tile('HRV', hrv.now, ' ms', hrv.delta, 'up'),
      tile('Steps a day', steps.now, '', steps.delta, 'up'),
      tile('SpO2', spo2.now, '%', spo2.delta, null, fmt1),
      tile('Breaths/min', resp.now, '', resp.delta, null, fmt1),
      tile('Skin temp', skin.now == null ? null : imperial() ? skin.now * 9 / 5 + 32 : skin.now, imperial() ? '°F' : '°C', skin.delta == null ? null : imperial() ? skin.delta * 9 / 5 : skin.delta, null, fmt1),
      h('a', { class: 'stat', href: '#/weight', style: { textDecoration: 'none', color: 'inherit' } },
        h('span', { class: 'num', style: { fontSize: '26px' } }, fmtW(model.trendKg), h('span', { class: 'unit' }, ` ${wUnit()}`)), h('span', { class: 'label' }, 'Trend weight'),
        model.weeklyChangeKg != null ? h('span', { class: 'tiny muted', style: { fontWeight: 600 } }, `${model.weeklyChangeKg <= 0 ? 'down' : 'up'} ${fmt1(Math.abs(toDisplayW(model.weeklyChangeKg)))}/wk`) : null),
      h('button', { class: 'stat stat-btn', onclick: () => openMeasurementSheet('bp', refresh), 'aria-label': bp ? `Blood pressure ${bp.value} over ${bp.value2}, add a reading` : 'Add a blood pressure reading' },
        h('span', { class: 'num', style: { fontSize: '26px' } }, bp ? `${fmt0(bp.value)}/${fmt0(bp.value2)}` : '-'), h('span', { class: 'label' }, 'Blood pressure'),
        h('span', { class: 'tiny muted', style: { fontWeight: 600 } }, bp ? relDay(bp.date) : 'Add a reading'))),
    summary.whoop.connected ? null : h('p', { class: 'note small' }, 'Connect WHOOP in Settings to fill in heart rate, HRV, steps and sleep.'));

  const sl = days.slice(-7);
  const slHrs = sl.map(d => d.whoop?.sleep_hours ?? null);
  const need = avg(sl.map(d => d.whoop?.sleep_need_hours ?? null));
  const sleep = h('section', { class: 'card', 'aria-label': 'Sleep, last 7 nights' },
    h('div', { class: 'card-head' }, h('h2', null, 'Sleep'), h('span', { class: 'small muted' }, avg(slHrs) != null ? `avg ${hoursMin(avg(slHrs))}${need ? `, ${fmt0(avg(slHrs) / need * 100)}% of need` : ''}` : 'No sleep data this week')),
    chart({ n: 7, w: 1100, h: 200, yMin: 0, bars: [{ values: slHrs, color: 'var(--primary)' }], lines: need ? [{ values: sl.map(d => d.whoop?.sleep_need_hours ?? null), color: 'var(--kcal)', width: 2, dash: '5 4' }] : [],
      xLabels: sl.map((d, i) => ({ i, text: new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) })), yFormat: (v) => `${v}h`,
      label: `Hours asleep the last 7 nights: ${slHrs.map(v => (v == null ? 'none' : v.toFixed(1))).join(', ')}` }),
    need ? h('div', { class: 'legend' }, h('span', null, h('i', { style: { width: '16px', height: '3px', background: 'var(--kcal)' } }), 'Sleep need')) : null,
    h('a', { class: 'small', href: '#/whoop' }, 'WHOOP details'));

  const meds = medsCard(data.items, todayISO(), refresh);

  const oor = data.labs_latest.out_of_range;
  const lastG = data.glucose[data.glucose.length - 1];
  const labs = h('a', { class: 'card linkish', href: '#/health/labs', 'aria-label': 'Labs and blood sugar' },
    h('div', { class: 'card-head' }, h('h2', null, 'Labs and blood sugar'), icon('right', 20)),
    h('p', { class: 'note' }, [
      data.labs_latest.date ? `Panel from ${shortDate(data.labs_latest.date)}: ${data.labs_latest.results.length} results${oor.length ? `, ${oor.length} outside range (${oor.slice(0, 3).map(l => `${l.marker} ${l.value}`).join(', ')})` : ', all in range'}.` : 'No lab results yet.',
      lastG ? `Last blood sugar ${fmt0(lastG.mg_dl)} mg/dL, ${CONTEXT_LABEL[lastG.context]?.toLowerCase() || ''} ${relDayLc(lastG.date)}.` : '',
    ].filter(Boolean).join(' ')));

  root.replaceChildren(
    pageHead('Vitals, sleep, meds and labs', 'Health', [
      h('button', { class: 'btn sm', onclick: () => openGlucoseSheet({ onDone: refresh }) }, 'Blood sugar'),
      h('button', { class: 'btn sm', onclick: () => openMeasurementSheet(null, refresh) }, 'Add measurement')]),
    h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('div', { class: 'grow-3 stack' }, vitals), h('div', { class: 'grow-2 stack' }, meds, labs)),
      sleep,
      h('p', { class: 'note small' }, 'A personal record for you, not medical advice. Ask your doctor about anything that concerns you.')));
}

/* ---------- medications and supplements ---------- */

export const FREQS = [['daily', 'Daily'], ['twice', 'Twice a day'], ['thrice', '3 times a day'], ['weekly', 'Weekly'], ['interval', 'Every few days'], ['prn', 'As needed']];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ord = (n) => ['1st', '2nd', '3rd'][n] || `${n + 1}th`;
const clock = (unix) => new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const hhmm = (t) => { const [a, b] = t.split(':').map(Number); return new Date(2000, 0, 1, a, b).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(); };

/** Short description of a schedule: "Twice a day", "Sundays", "Every 3 days". */
export function freqText(i) {
  const s = i.schedule;
  if (i.frequency === 'weekly') return s.weekdays.length === 7 ? 'Daily' : s.weekdays.length === 1 ? `${DOW_LONG[s.weekdays[0]]}s` : s.weekdays.map(d => DOW_LONG[d].slice(0, 3)).join(', ');
  if (i.frequency === 'interval') return `Every ${s.every} days`;
  if (i.frequency === 'prn') return s.max ? `As needed, up to ${s.max} a day` : 'As needed';
  return { daily: 'Daily', twice: 'Twice a day', thrice: '3 times a day' }[i.frequency];
}
/** freqText for mid-sentence: lowercase, but weekday names keep their capital. */
const freqLc = (i) => (i.frequency === 'weekly' ? freqText(i) : freqText(i).toLowerCase());
function tagFor(i) {
  if (i.supply_days != null && i.supply_days <= 7) return h('span', { class: 'badge refill' }, 'Refill soon');
  const t = { daily: 'Daily', twice: '2× a day', thrice: '3× a day', weekly: 'Weekly', interval: `Every ${i.schedule.every}d` }[i.frequency];
  return t ? h('span', { class: `badge freq-${i.frequency}` }, t) : null;
}

/** All doses due on `date`, flattened: [{item, dose}]. */
function dueDoses(items) {
  return items.filter(i => i.frequency !== 'prn').flatMap(i => i.doses.map(d => ({ item: i, dose: d })));
}

function doseRow({ item: i, dose: d }, date, redraw) {
  const id = `dose-${i.id}-${d.slot}`;
  const n = i.doses.length;
  const bits = [n > 1 ? `${ord(d.slot)} of ${n} doses` : null,
    d.taken_at ? `taken ${clock(d.taken_at)}` : i.frequency === 'weekly' || i.frequency === 'interval' ? `Due today, ${freqLc(i)}` : hhmm(d.time),
    i.supply != null ? `${i.supply} left${i.supply_days != null ? `, ${i.supply_days} day${i.supply_days === 1 ? '' : 's'}` : ''}` : null];
  return h('label', { class: 'check-row', for: id },
    h('input', { type: 'checkbox', id, checked: !!d.taken_at, onchange: async (e) => {
      try { const r = await post('health/dose', { item_id: i.id, date, slot: d.slot, taken: e.target.checked }); redraw(r.items || []); }
      catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'error'); }
    } }),
    h('span', { class: 'main' },
      h('span', { class: 'title' }, i.name, i.dose ? h('span', { class: 'muted', style: { fontWeight: 500 } }, `, ${i.dose}`) : null),
      h('span', { class: 'small muted' }, bits.filter(Boolean).join(', '))),
    tagFor(i));
}

function prnRow(i, date, redraw) {
  const today = i.taken_today || [];
  const atMax = i.schedule.max && today.length >= i.schedule.max;
  return h('div', { class: 'check-row prn-row' },
    h('span', { class: 'main' },
      h('span', { class: 'title' }, i.name, i.dose ? h('span', { class: 'muted', style: { fontWeight: 500 } }, `, ${i.dose}`) : null),
      h('span', { class: 'small muted' }, [
        today.length ? `${today.length} today, last at ${clock(today[today.length - 1].taken_at)}` : i.last_taken_at ? `Last taken ${relDayLc(new Date(i.last_taken_at * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10))} at ${clock(i.last_taken_at)}` : 'Not taken yet',
        i.schedule.max ? `Up to ${i.schedule.max} a day` : null, i.supply != null ? `${i.supply} left` : null].filter(Boolean).join('. '))),
    today.length ? h('button', { class: 'btn sm ghost', 'aria-label': `Undo the last ${i.name} dose`, onclick: async () => {
      try { const r = await post('health/dose', { item_id: i.id, date, slot: today[today.length - 1].slot, taken: false }); redraw(r.items); } catch (e) { toast(e.message, 'error'); }
    } }, 'Undo') : null,
    h('button', { class: 'btn sm primary', onclick: async () => {
      if (atMax && !(await confirmSheet('Over your daily limit?', `You've logged ${today.length} doses of ${i.name} today, your limit is ${i.schedule.max}. Log another anyway?`, 'Log it'))) return;
      try { const r = await post('health/dose', { item_id: i.id, date, taken: true }); redraw(r.items); toast(`${i.name} logged`); } catch (e) { toast(e.message, 'error'); }
    } }, 'Log a dose'));
}

/** Checklist for a day: due doses grouped by part of day, then as-needed items, then what's coming up. */
export function medsChecklist(items, date, redraw, { upcoming = true } = {}) {
  const doses = dueDoses(items);
  const prn = items.filter(i => i.frequency === 'prn');
  const later = items.filter(i => i.frequency !== 'prn' && !i.due && i.next_due);
  const groups = TIMES.map(([t, label]) => [label, doses.filter(x => x.dose.part === t).sort((a, b) => (a.dose.time < b.dose.time ? -1 : 1))]).filter(([, r]) => r.length);
  return h('div', { class: 'list' },
    groups.flatMap(([label, rows]) => [h('span', { class: 'list-label' }, label), ...rows.map(x => doseRow(x, date, redraw))]),
    prn.length ? [h('span', { class: 'list-label' }, 'As needed'), ...prn.map(i => prnRow(i, date, redraw))] : null,
    upcoming && later.length ? h('p', { class: 'small muted coming-up' }, 'Not due today: ', later.map(i => `${i.name}, ${freqLc(i)}, next ${relDayLc(i.next_due)}`).join('; '), '.') : null);
}

function medsCard(items, date, refresh) {
  const box = h('section', { class: 'card', 'aria-label': 'Medications and supplements' });
  const draw = (list) => {
    const doses = dueDoses(list);
    const taken = doses.filter(x => x.dose.taken_at).length;
    box.replaceChildren(...[
      h('div', { class: 'card-head' }, h('h2', null, h('a', { href: '#/health/meds', class: 'linkish' }, 'Meds and supplements')),
        h('button', { class: 'btn sm ghost', onclick: () => manageItems(() => refresh()) }, list.length ? 'Edit list' : 'Add')),
      list.length ? h('p', { class: 'small muted' }, doses.length ? `${taken} of ${doses.length} doses taken today` : 'Nothing scheduled today')
        : h('p', { class: 'note' }, 'Add what you take, with how often, then tick each dose off. Reminders can nudge you at each dose time.'),
      list.length ? medsChecklist(list, date, draw) : null].filter(Boolean));
  };
  draw(items);
  return box;
}

/** Full-screen checklist (#/health/meds), where reminders lead. */
export async function renderMeds(root) {
  root.replaceChildren(loading());
  const date = todayISO();
  const r = await get('health/items', { date });
  const refresh = () => renderMeds(root);
  const hero = h('section', { class: 'card', 'aria-label': 'Today' });
  const list = h('section', { class: 'card', 'aria-label': 'Checklist', style: { gap: 0 } });
  const draw = (items) => {
    const doses = dueDoses(items);
    const taken = doses.filter(x => x.dose.taken_at).length;
    hero.replaceChildren(h('div', { class: 'card-head', style: { alignItems: 'center' } },
      h('span', { class: 'num', style: { fontSize: '40px', color: 'var(--green)' } }, taken, h('span', { class: 'unit', style: { fontSize: '20px' } }, ` of ${doses.length} doses today`)),
      h('button', { class: 'btn sm', onclick: () => manageItems(refresh) }, 'Edit list')));
    list.replaceChildren(...[items.length ? medsChecklist(items, date, draw) : h('p', { class: 'note' }, 'Nothing on your list yet.'),
      items.length ? null : h('button', { class: 'btn primary', style: { alignSelf: 'flex-start', marginTop: '12px' }, onclick: () => editItem(null, refresh) }, 'Add a medication or supplement')].filter(Boolean));
  };
  draw(r.items);
  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('a', { href: '#/health', class: 'back-link' }, icon('left', 18), 'Health'), h('h1', null, 'Meds and supplements'))),
    h('div', { class: 'stack', style: { maxWidth: '640px' } }, hero, list,
      h('p', { class: 'note small' }, 'Reminders for each dose time are set in ', h('a', { href: '#/settings/sync' }, 'Reminders and sync'), '.')));
}

/** Today's checklist in a sheet (from the + button). */
export function openMedsSheet({ onDone } = {}) {
  let changed = false;
  openSheet({
    title: 'Meds and supplements',
    onClose: () => { if (changed) onDone?.(); },
    body: async (sheet) => {
      const r = await get('health/items', { date: todayISO() });
      if (!r.items.length) {
        sheet.body.append(h('p', { class: 'note' }, 'Nothing on your list yet.'),
          h('button', { class: 'btn primary block', onclick: () => { sheet.close(); manageItems(() => openMedsSheet({ onDone })); } }, 'Add a medication or supplement'));
        return;
      }
      const box = h('div');
      const draw = (items) => { changed = true; box.replaceChildren(medsChecklist(items, todayISO(), draw)); };
      draw(r.items); changed = false;
      sheet.body.append(box, h('a', { class: 'btn block', href: '#/health/meds', onclick: () => sheet.close() }, 'Manage the list'));
    },
  });
}

function manageItems(onDone) {
  openSheet({
    title: 'Your list',
    tall: true,
    onClose: onDone,
    body: async (sheet) => {
      const list = h('div', { class: 'list' });
      let items = [];
      const draw = () => list.replaceChildren(...(items.length ? items.map(i => h('div', { class: 'list-row sort-row', 'data-key': String(i.id), 'data-label': i.name },
        gripHandle(i.name),
        h('button', { class: 'main row-btn', onclick: () => editItem(i, reload) },
          h('span', { class: 'title' }, i.name + (i.dose ? `, ${i.dose}` : '')),
          h('span', { class: 'small muted' }, [i.kind === 'medication' ? 'Medication' : 'Supplement', freqText(i),
            i.frequency !== 'prn' ? i.schedule.times.map(t => hhmm(t.time)).join(' and ') : null,
            i.supply != null ? `${i.supply} left` : null, i.active ? null : 'paused'].filter(Boolean).join(', '))),
        h('button', { class: 'icon-btn', 'aria-label': `Edit ${i.name}`, onclick: () => editItem(i, reload) }, icon('edit', 18)))) : [h('p', { class: 'note' }, 'Nothing yet.')]));
      const reload = async () => { items = (await get('health/items', { all: 1 })).items; draw(); };
      makeSortable(list, { onChange: async (keys) => {
        items = keys.map(k => items.find(i => String(i.id) === k));
        try { await post('health/items/order', { ids: keys.map(Number) }); } catch (e) { toast(e.message, 'error'); }
      } });
      await reload();
      sheet.body.append(h('p', { class: 'note small' }, 'Tap an item to change it. Drag the handle to change the order.'), list,
        h('button', { class: 'btn primary block', onclick: () => editItem(null, reload) }, 'Add medication or supplement'),
        h('p', { class: 'note small' }, 'Supply is optional. Enter how many doses you have and it counts down as you tick them off.'));
    },
  });
}

function editItem(item, onSaved) {
  const sel = (id, value, opts) => h('select', { id, class: 'input' }, opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  let freq = item?.frequency || 'daily';
  const sched = structuredClone(item?.schedule || { times: [{ slot: 'morning', time: '08:00' }] });
  sched.weekdays ??= [new Date().getDay()];
  sched.every ??= 2;
  sched.start ??= todayISO();
  const DEF = { morning: '08:00', midday: '12:30', evening: '19:00', bedtime: '22:00', any: '09:00' };
  const fill = { daily: ['morning'], twice: ['morning', 'evening'], thrice: ['morning', 'midday', 'evening'], weekly: ['morning'], interval: ['morning'] };

  const chips = h('div', { class: 'pills', role: 'group', 'aria-label': 'How often' });
  const timesBox = h('div', { class: 'dose-times' });
  const extra = h('div', { class: 'stack' });
  const supplyIn = h('input', { id: 'hi-sup', inputmode: 'numeric', value: item?.supply ?? '' });
  const lasts = h('span', { class: 'small muted' });
  const remindIn = h('input', { type: 'checkbox', id: 'hi-rem', checked: item ? item.remind : true });
  const refillIn = h('input', { type: 'checkbox', id: 'hi-ref', checked: item ? item.refill_remind : true });

  const perDay = () => (freq === 'prn' ? null : freq === 'weekly' ? sched.times.length * sched.weekdays.length / 7 : freq === 'interval' ? sched.times.length / sched.every : sched.times.length);
  const syncLasts = () => {
    const n = parseInt(supplyIn.value, 10), p = perDay();
    if (!n || !p) { lasts.textContent = freq === 'prn' && n ? 'Counts down each time you log a dose.' : ''; return; }
    const d = Math.floor(n / p);
    const end = new Date(Date.now() + d * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    lasts.textContent = `Lasts about ${d} day${d === 1 ? '' : 's'}, until ${end}`;
  };
  const draw = () => {
    const want = fill[freq];
    if (want && freq !== sched._for) {
      // Keep times you've already set; add or drop slots to match the frequency.
      const keep = sched.times.slice(0, want.length);
      sched.times = want.map((slot, k) => keep[k] || { slot, time: DEF[slot] });
      sched._for = freq;
    }
    chips.replaceChildren(...FREQS.map(([k, l]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(k === freq), onclick: () => { freq = k; draw(); } }, l)));
    timesBox.hidden = freq === 'prn';
    timesBox.replaceChildren(...sched.times.map((t, k) => h('div', { class: 'dose-time' },
      h('span', { class: 'dt-label' }, sched.times.length > 1 ? `Dose ${k + 1}` : 'Time'),
      h('select', { class: 'input', 'aria-label': `Dose ${k + 1} part of day`, onchange: (e) => { t.slot = e.target.value; } }, TIMES.map(([v, l]) => h('option', { value: v, selected: v === t.slot }, l))),
      h('input', { class: 'input', type: 'time', value: t.time, 'aria-label': `Dose ${k + 1} reminder time`, onchange: (e) => {
        t.time = e.target.value || t.time;
        const hr = +t.time.slice(0, 2);
        t.slot = hr < 11 ? 'morning' : hr < 16 ? 'midday' : hr < 21 ? 'evening' : 'bedtime';
        draw();
      } }))));
    extra.replaceChildren(...[
      freq === 'weekly' ? h('fieldset', { class: 'scale-set' }, h('legend', null, 'On these days'),
        h('div', { class: 'day-pick' }, DOW.map((d, k) => h('button', { type: 'button', 'aria-pressed': String(sched.weekdays.includes(k)), 'aria-label': DOW_LONG[k], onclick: () => {
          sched.weekdays = sched.weekdays.includes(k) ? sched.weekdays.filter(x => x !== k) : [...sched.weekdays, k].sort();
          if (!sched.weekdays.length) sched.weekdays = [k];
          draw();
        } }, d)))) : null,
      freq === 'interval' ? h('div', { class: 'grid-2' },
        h('label', { class: 'field', for: 'hi-every' }, 'Every how many days', h('input', { id: 'hi-every', inputmode: 'numeric', value: sched.every, onchange: (e) => { sched.every = Math.max(2, Math.min(60, parseInt(e.target.value, 10) || 2)); syncLasts(); } })),
        h('label', { class: 'field', for: 'hi-start' }, 'Starting', h('input', { id: 'hi-start', type: 'date', value: sched.start, onchange: (e) => { sched.start = e.target.value; } }))) : null,
      freq === 'prn' ? h('label', { class: 'field', for: 'hi-max' }, 'Most doses in a day (optional)', h('input', { id: 'hi-max', inputmode: 'numeric', value: sched.max ?? '', onchange: (e) => { sched.max = e.target.value ? +e.target.value : null; } })) : null].filter(Boolean));
    extra.hidden = !extra.children.length;
    remindIn.closest('label') && (remindIn.closest('label').hidden = freq === 'prn');
    syncLasts();
  };
  supplyIn.addEventListener('input', syncLasts);

  const s = openSheet({
    title: item ? 'Edit' : 'Add to your list',
    tall: true,
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = (id) => f.querySelector('#' + id).value;
      const { _for, ...clean } = sched;
      try {
        await post('health/items/save', { id: item?.id, name: v('hi-name'), dose: v('hi-dose'), kind: v('hi-kind'), frequency: freq, schedule: clean,
          supply: supplyIn.value === '' ? null : +supplyIn.value, remind: remindIn.checked, refill_remind: refillIn.checked, active: f.querySelector('#hi-act').checked });
        s.close(); toast('Saved'); onSaved?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'hi-name' }, 'Name', h('input', { id: 'hi-name', required: true, value: item?.name || '', placeholder: 'Vitamin D3' })),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field', for: 'hi-dose' }, 'Dose (optional)', h('input', { id: 'hi-dose', value: item?.dose || '', placeholder: '2,000 IU' })),
        h('label', { class: 'field', for: 'hi-kind' }, 'Type', sel('hi-kind', item?.kind || 'supplement', [['supplement', 'Supplement'], ['medication', 'Medication']]))),
      h('fieldset', { class: 'scale-set' }, h('legend', null, 'How often'), chips),
      timesBox, extra,
      h('div', { class: 'grid-2', style: { alignItems: 'end' } },
        h('label', { class: 'field', for: 'hi-sup' }, 'Doses on hand (optional)', supplyIn), lasts),
      h('div', { class: 'list' },
        h('label', { class: 'check-row', for: 'hi-rem' }, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Remind me at each dose'), h('span', { class: 'small muted' }, 'Skipped if already ticked off')), remindIn),
        h('label', { class: 'check-row', for: 'hi-ref' }, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Refill reminder'), h('span', { class: 'small muted' }, 'When about 7 days of supply are left')), refillIn),
        h('label', { class: 'check-row', for: 'hi-act' }, h('span', { class: 'main' }, h('span', { class: 'title' }, 'On the daily checklist'), h('span', { class: 'small muted' }, 'Untick to pause it and keep its history')), h('input', { type: 'checkbox', id: 'hi-act', checked: item ? item.active : true }))),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save'),
      item ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet(`Delete ${item.name}?`, 'This also deletes its taken history. To stop tracking but keep the history, untick "On the daily checklist" instead.'))) return;
        await post('health/items/delete', { id: item.id }); s.close(); onSaved?.();
      } }, 'Delete') : null),
  });
  sched._for = item ? freq : null;
  draw();
}

/* ---------- measurements ---------- */

function openMeasurementSheet(kind, onDone) {
  const kinds = [['vo2max', 'VO2 max'], ['bp', 'Blood pressure'], ['body_fat', 'Body fat %'], ['waist', `Waist (${imperial() ? 'in' : 'cm'})`]]; // more tape measurements live on the Body screen
  const kindSel = h('select', { class: 'input', id: 'ms-kind' }, kinds.map(([v, l]) => h('option', { value: v, selected: v === (kind || 'vo2max') }, l)));
  const val = h('input', { class: 'input big', id: 'ms-val', inputmode: 'decimal' });
  const val2 = h('input', { class: 'input big', id: 'ms-val2', inputmode: 'numeric' });
  const v2field = h('label', { class: 'field', for: 'ms-val2' }, 'Diastolic (bottom)', val2);
  const vLabel = h('span');
  const hint = h('p', { class: 'note small' });
  const sync = () => {
    const k = kindSel.value;
    v2field.hidden = k !== 'bp';
    vLabel.textContent = { vo2max: 'VO2 max (ml/kg/min)', bp: 'Systolic (top)', body_fat: 'Body fat (%)', waist: `Waist (${imperial() ? 'in' : 'cm'})` }[k];
    hint.textContent = k === 'vo2max' ? 'In the WHOOP app, VO2 max is under Health > VO2 max. It changes slowly, so updating every week or two is plenty.' : '';
  };
  kindSel.addEventListener('change', sync);
  const dateIn = h('input', { class: 'input', type: 'date', id: 'ms-date', value: todayISO(), max: todayISO() });
  const s = openSheet({
    title: 'Add measurement',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const k = kindSel.value;
      let v = parseFloat(val.value.replace(',', '.'));
      if (k === 'waist' && imperial()) v *= 2.54;
      try {
        await post('measurements/save', { date: dateIn.value, kind: k, value: v, value2: k === 'bp' ? parseFloat(val2.value) : null });
        s.close(); toast('Saved'); onDone?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      kind ? null : h('label', { class: 'field', for: 'ms-kind' }, 'What', kindSel),
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'ms-val' }, vLabel, val), v2field),
      h('label', { class: 'field', for: 'ms-date' }, 'Date', dateIn),
      hint,
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save')),
  });
  sync();
  setTimeout(() => val.focus(), 40);
}

/* ---------- blood sugar ---------- */

export function openGlucoseSheet({ onDone, reading = null } = {}) {
  const ctxGuess = () => { const hr = new Date().getHours(); return hr < 9 ? 'fasting' : 'after_meal_2h'; };
  const val = h('input', { class: 'input big', id: 'gl-val', inputmode: 'numeric', value: reading ? fmt0(reading.mg_dl) : '' });
  const ctx = h('select', { class: 'input', id: 'gl-ctx' }, CONTEXTS.map(([v, l]) => h('option', { value: v, selected: v === (reading?.context || ctxGuess()) }, l)));
  const dateIn = h('input', { class: 'input', type: 'date', id: 'gl-date', value: reading?.date || todayISO(), max: todayISO() });
  const timeIn = h('input', { class: 'input', type: 'time', id: 'gl-time', value: reading?.time || nowHHMM() });
  const s = openSheet({
    title: reading ? 'Edit reading' : 'Blood sugar',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const v = parseFloat(val.value.replace(',', '.'));
      if (!v) { toast('Enter a reading', 'error'); return; }
      try {
        await post('glucose/save', { id: reading?.id, mg_dl: v, context: ctx.value, date: dateIn.value, time: timeIn.value });
        s.close(); toast('Reading saved'); onDone?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'gl-val' }, 'mg/dL', val), h('label', { class: 'field', for: 'gl-ctx' }, 'When', ctx)),
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'gl-date' }, 'Date', dateIn), h('label', { class: 'field', for: 'gl-time' }, 'Time', timeIn)),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save reading'),
      reading ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        await post('glucose/delete', { id: reading.id }); s.close(); toast('Reading deleted'); onDone?.();
      } }, 'Delete reading') : null),
  });
  setTimeout(() => val.focus(), 40);
}

/* ---------- labs screen ---------- */

let glucoseSpan = 30;
let panelDate = null;

async function renderLabs(root) {
  root.replaceChildren(loading());
  const from = new Date(Date.now() - glucoseSpan * 86400000).toISOString().slice(0, 10);
  const [{ readings }, { labs }] = await Promise.all([get('glucose', { from }), get('labs')]);
  const refresh = () => renderLabs(root);

  // Blood sugar chart: one column per day, fasting as dots, other readings as diamonds.
  const dates = [];
  for (let i = glucoseSpan - 1; i >= 0; i--) dates.push(new Date(Date.now() - i * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const di = Object.fromEntries(dates.map((d, i) => [d, i]));
  const fasting = dates.map(() => null), other = dates.map(() => null);
  for (const r of readings) {
    const i = di[r.date]; if (i == null) continue;
    if (r.context === 'fasting') fasting[i] = r.mg_dl; else other[i] = Math.max(other[i] ?? 0, r.mg_dl);
  }
  const fastAvg = avg(readings.filter(r => r.context === 'fasting').map(r => r.mg_dl));
  const last = readings[readings.length - 1];
  const glucose = h('section', { class: 'card', 'aria-label': 'Blood sugar' },
    h('div', { class: 'card-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('h2', null, 'Blood sugar'),
        h('span', { class: 'small muted' }, fastAvg ? `Fasting average ${fmt0(fastAvg)} mg/dL over ${glucoseSpan} days` : 'No fasting readings in this range')),
      last ? h('span', { class: 'num', style: { fontSize: '34px' } }, fmt0(last.mg_dl), h('span', { class: 'unit' }, ' mg/dL')) : null),
    h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Range', style: { maxWidth: '260px' } },
      [[14, '2 weeks'], [30, '30 days'], [90, '90 days']].map(([d, l]) => h('button', { role: 'tab', 'aria-selected': String(glucoseSpan === d), onclick: () => { glucoseSpan = d; renderLabs(root); } }, l))),
    readings.length ? chart({ n: dates.length, w: 640, h: 180, yMin: 60, dots: [{ values: other, color: 'var(--kcal)', r: 4 }, { values: fasting, color: 'var(--primary)', r: 4.5 }],
      hline: { value: 140, color: 'var(--muted)' }, xLabels: dateTicks(dates, 3), yFormat: fmt0,
      label: `Blood sugar readings for ${glucoseSpan} days. Fasting average ${fmt0(fastAvg)} mg/dL. Dashed line at 140.` }) : null,
    readings.length ? h('div', { class: 'legend' },
      h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '5px', background: 'var(--primary)' } }), 'Fasting'),
      h('span', null, h('i', { style: { width: '10px', height: '10px', borderRadius: '5px', background: 'var(--kcal)' } }), 'Other readings (highest of the day)'),
      h('span', null, h('i', { style: { width: '16px', height: '0', borderTop: '2px dashed var(--muted)' } }), '140 mg/dL')) : null,
    h('button', { class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: () => openGlucoseSheet({ onDone: refresh }) }, icon('plus', 18), 'Add reading'),
    readings.length ? h('div', { class: 'list' }, [...readings].reverse().slice(0, 8).map(r => h('button', { class: 'list-row', onclick: () => openGlucoseSheet({ reading: r, onDone: refresh }) },
      h('div', { class: 'main' }, h('span', { class: 'title' }, `${fmt0(r.mg_dl)} mg/dL`), h('span', { class: 'small muted' }, `${relDay(r.date)}, ${r.time || ''}, ${CONTEXT_LABEL[r.context] || ''}`)),
      icon('edit', 18)))) : null);

  // Lab panels by date.
  const panels = [...new Set(labs.map(l => l.date))];
  if (!panels.includes(panelDate)) panelDate = panels[0] || null;
  const rows = labs.filter(l => l.date === panelDate);
  const panelSel = panels.length ? h('select', { class: 'input', id: 'lab-panel', style: { width: 'auto', height: '40px' }, onchange: (e) => { panelDate = e.target.value; renderLabs(root); } },
    panels.map(d => h('option', { value: d, selected: d === panelDate }, shortDate(d)))) : null;
  const labCard = h('section', { class: 'card', 'aria-label': 'Lab results' },
    h('div', { class: 'card-head' }, h('h2', null, 'Lab results'),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
        panelSel ? h('label', { class: 'sr', for: 'lab-panel' }, 'Panel date') : null, panelSel,
        h('button', { class: 'btn sm', onclick: () => editPanel(null, labs, (d) => { panelDate = d; refresh(); }) }, 'Add results'))),
    rows.length ? h('div', { class: 'list' }, rows.map(l => labRow(l, labs, refresh)))
      : h('p', { class: 'note' }, 'Add results from a blood test to track them over time. Each result shows where it sits in its reference range.'),
    rows.length ? h('button', { class: 'btn sm ghost', style: { alignSelf: 'flex-start' }, onclick: () => editPanel(panelDate, labs, (d) => { panelDate = d; refresh(); }) }, 'Edit this panel') : null,
    h('p', { class: 'tiny muted' }, 'Ranges come from your lab report. This is a record, not medical advice.'));

  root.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('a', { href: '#/health', class: 'back-link' }, icon('left', 18), 'Health'),
        h('h1', null, 'Labs and blood sugar'))),
    h('div', { class: 'row' }, h('div', { class: 'grow-2 stack' }, glucose), h('div', { class: 'grow-3 stack' }, labCard)));
}

function rangeBar(l) {
  const lo = l.ref_low, hi = l.ref_high;
  const spanLo = lo != null ? lo : 0;
  const spanHi = hi != null ? hi : lo * 2;
  const min = Math.min(spanLo - (spanHi - spanLo) * 0.4, l.value), max = Math.max(spanHi + (spanHi - spanLo) * 0.4, l.value);
  const pct = (v) => `${(((v - min) / (max - min || 1)) * 100).toFixed(1)}%`;
  const out = (lo != null && l.value < lo) || (hi != null && l.value > hi);
  return h('div', { class: 'range-bar', role: 'img', 'aria-label': `${l.marker} ${l.value} ${l.unit || ''}, ${lo != null && hi != null ? `range ${lo} to ${hi}` : lo != null ? `at least ${lo}` : `at most ${hi}`}, ${out ? 'outside range' : 'in range'}` },
    h('div', { class: 'ok', style: { left: lo != null ? pct(lo) : '0', right: hi != null ? `calc(100% - ${pct(hi)})` : '0' } }),
    h('div', { class: 'mark' + (out ? ' out' : ''), style: { left: pct(l.value) } }));
}

function labRow(l, all, refresh) {
  const out = (l.ref_low != null && l.value < l.ref_low) || (l.ref_high != null && l.value > l.ref_high);
  const prev = all.filter(x => x.marker === l.marker && x.date < l.date)[0];
  const range = l.ref_low != null && l.ref_high != null ? `${l.ref_low}–${l.ref_high}` : l.ref_low != null ? `${l.ref_low} or more` : l.ref_high != null ? `${l.ref_high} or less` : 'no range';
  return h('button', { class: 'lab-row', onclick: () => labDetail(l, all, refresh) },
    h('div', { class: 'lab-head' }, h('span', { class: 'title' }, l.marker),
      h('span', null, h('span', { class: 'num', style: { fontSize: '20px', color: out ? 'var(--red)' : 'inherit' } }, String(l.value)), h('span', { class: 'small muted' }, ` ${l.unit || ''}`))),
    l.ref_low != null || l.ref_high != null ? rangeBar(l) : null,
    h('div', { class: 'lab-foot' }, h('span', null, `Range ${range}`), h('span', null, prev ? `${shortDate(prev.date).split(', ').slice(1).join(', ')}: ${prev.value}` : '')));
}

function labDetail(l, all, refresh) {
  const hist = all.filter(x => x.marker === l.marker).sort((a, b) => (a.date < b.date ? -1 : 1));
  const sh = openSheet({
    title: l.marker,
    body: h('div', { class: 'stack' },
      hist.length > 1 ? chart({ n: hist.length, w: 520, h: 180, lines: [{ values: hist.map(x => x.value), color: 'var(--primary)', endDot: true }], dots: [{ values: hist.map(x => x.value), color: 'var(--primary)' }],
        hline: l.ref_high != null ? { value: l.ref_high, color: 'var(--red)' } : l.ref_low != null ? { value: l.ref_low, color: 'var(--red)' } : null,
        xLabels: dateTicks(hist.map(x => x.date), Math.min(3, hist.length)), yFormat: (v) => String(+v.toFixed(2)), label: `${l.marker} over time` })
        : h('p', { class: 'note' }, 'Add this marker from another test to see a trend.'),
      h('table', { class: 'table' }, h('tbody', null, [...hist].reverse().map(x => h('tr', null, h('td', null, shortDate(x.date)), h('td', { class: 'r', style: { fontWeight: 600 } }, `${x.value} ${x.unit || ''}`))))),
      h('button', { class: 'btn block danger', onclick: async () => {
        if (!(await confirmSheet('Delete this result?', `${l.marker} ${l.value} from ${shortDate(l.date)}.`))) return;
        await post('labs/delete', { id: l.id }); sh.close(); refresh();
      } }, 'Delete this result')),
  });
}

function editPanel(date, all, onSaved) {
  const existing = date ? all.filter(l => l.date === date) : [];
  const lastPanel = all.length ? all.filter(l => l.date === all[0].date) : [];
  const rows = existing.length ? existing.map(l => ({ ...l })) : [{}];
  openSheet({
    title: date ? `Panel, ${shortDate(date)}` : 'Add lab results',
    tall: true,
    body: (sheet) => {
      const dateIn = h('input', { class: 'input', type: 'date', id: 'lp-date', value: date || todayISO(), max: todayISO() });
      const box = h('div', { class: 'stack' });
      const dl = h('datalist', { id: 'lab-markers' }, LAB_PRESETS.map(([m]) => h('option', { value: m })));
      const draw = () => box.replaceChildren(...rows.map((r, i) => {
        const f = (k, label, attrs = {}) => h('label', { class: 'field' }, label, h('input', { value: r[k] ?? '', ...attrs, oninput: (e) => {
          r[k] = e.target.value;
          if (k === 'marker') {
            const p = LAB_PRESETS.find(x => x[0].toLowerCase() === e.target.value.trim().toLowerCase());
            if (p && !r.unit && r.ref_low == null && r.ref_high == null) { r.unit = p[1]; r.ref_low = p[2]; r.ref_high = p[3]; draw(); box.querySelectorAll('.lab-edit')[i]?.querySelector('input')?.focus(); }
          }
        } }));
        return h('div', { class: 'lab-edit' },
          h('div', { class: 'grid-2' }, f('marker', 'Marker', { list: 'lab-markers', placeholder: 'LDL cholesterol' }), f('value', 'Result', { inputmode: 'decimal' })),
          h('div', { class: 'grid-3' }, f('unit', 'Unit', { placeholder: 'mg/dL' }), f('ref_low', 'Range low', { inputmode: 'decimal' }), f('ref_high', 'Range high', { inputmode: 'decimal' })),
          rows.length > 1 || r.id ? h('button', { class: 'btn sm ghost danger', type: 'button', style: { alignSelf: 'flex-start' }, onclick: async () => {
            if (r.id) await post('labs/delete', { id: r.id });
            rows.splice(i, 1); if (!rows.length) rows.push({}); draw();
          } }, 'Remove') : null);
      }));
      draw();
      sheet.body.append(
        h('label', { class: 'field', for: 'lp-date' }, 'Test date', dateIn), dl, box,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => { rows.push({}); draw(); box.lastChild?.querySelector('input')?.focus(); } }, 'Add a row'),
          !date && lastPanel.length ? h('button', { class: 'btn sm', type: 'button', onclick: () => {
            rows.splice(0, rows.length, ...lastPanel.map(l => ({ marker: l.marker, unit: l.unit, ref_low: l.ref_low, ref_high: l.ref_high })));
            draw();
          } }, 'Use the markers from the last panel') : null),
        h('p', { class: 'note small' }, 'Pick a common marker to fill in a typical unit and range, then match them to your report.'),
        h('button', { class: 'btn primary block', onclick: async () => {
          const results = rows.filter(r => String(r.marker || '').trim() && String(r.value ?? '').trim() !== '');
          if (!results.length) { toast('Enter at least one marker and result', 'error'); return; }
          try {
            await post('labs/save', { date: dateIn.value, results: results.map(r => ({ ...r, value: String(r.value).replace(',', '.') })) });
            sheet.close(); toast('Results saved'); onSaved?.(dateIn.value);
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Save results'));
    },
  });
}

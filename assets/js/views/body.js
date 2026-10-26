// Body: tape measurements and body fat, progress photos (with a camera that shows a faint outline of
// your last photo), and a side-by-side or slider comparison of two dates.
import { h, icon, fmt0, fmt1, todayISO, shortDate, relDay, openSheet, toast, confirmSheet, relDayLc } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, imperial, fmtW, wUnit, toDisplayW, markStale } from '../store.js';
import { pageHead, loading } from '../components.js';
import { chart, dateTicks } from '../charts.js';
import { addDays, daysBetween } from '../tdee.js';

export const BODY_PARTS = [
  ['waist', 'Waist'], ['hips', 'Hips'], ['chest', 'Chest'], ['neck', 'Neck'], ['shoulders', 'Shoulders'],
  ['arm_l', 'Arm, left'], ['arm_r', 'Arm, right'], ['thigh_l', 'Thigh, left'], ['thigh_r', 'Thigh, right'], ['calf_l', 'Calf, left'], ['calf_r', 'Calf, right'],
];
const PART = Object.fromEntries(BODY_PARTS);
// Smaller changes are noise for these (cm): waist, hips and thighs shrink on a cut; arms and chest grow.
const SHRINK_GOOD = new Set(['waist', 'hips']);
const POSES = [['front', 'Front'], ['side', 'Side'], ['back', 'Back']];

const lenUnit = () => (imperial() ? 'in' : 'cm');
const toLen = (cm) => (cm == null ? null : imperial() ? cm / 2.54 : cm);
const fromLen = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : imperial() ? +v * 2.54 : +v);
const fmtLen = (cm) => (cm == null ? '-' : imperial() ? (Math.round(toLen(cm) * 4) / 4).toFixed(2).replace(/0$/, '') : fmt1(cm));
/** A change in display units, rounded the way the values are (¼ inch or 0.1 cm), "0" when it rounds away. */
const fmtLenDiff = (cm) => {
  const v = imperial() ? Math.round(toLen(cm) * 4) / 4 : Math.round(cm * 10) / 10;
  if (!v) return '0';
  const a = Math.abs(v);
  return `${v > 0 ? '+' : '−'}${imperial() ? (a % 1 ? String(a) : a.toFixed(1)) : fmt1(a)}`;
};
const photoUrl = (id, thumb) => `api/?r=photos/file&id=${id}${thumb ? '&size=thumb' : ''}`;

let selectedPart = 'waist';

export async function render(root, params) {
  if (params[0] === 'photos') return renderPhotos(root);
  if (params[0] === 'compare') return renderCompare(root);
  return renderMeasurements(root);
}

function bodySwitch(current) {
  return h('nav', { class: 'segmented big', 'aria-label': 'Body sections' },
    h('a', { href: '#/body', 'aria-current': current === 'measure' ? 'page' : null }, 'Measurements'),
    h('a', { href: '#/body/photos', 'aria-current': current === 'photos' ? 'page' : null }, 'Photos'));
}

/* ---------- body fat ---------- */

/** US Navy tape estimate from waist, neck (and hips for women) in cm and height in cm. */
export function navyBodyFat(sex, heightCm, waist, neck, hips) {
  if (!heightCm || !waist || !neck) return null;
  let bf;
  if (sex === 'female') {
    if (!hips || waist + hips - neck <= 0) return null;
    bf = 495 / (1.29579 - 0.35004 * Math.log10(waist + hips - neck) + 0.221 * Math.log10(heightCm)) - 450;
  } else {
    if (waist - neck <= 0) return null;
    bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(heightCm)) - 450;
  }
  return bf > 2 && bf < 70 ? bf : null;
}

/** Latest value of each kind on or before `date`. */
function latestBy(rows, date = '9999-12-31') {
  const out = {};
  for (const r of rows) if (r.date <= date && (!out[r.kind] || out[r.kind].date <= r.date)) out[r.kind] = r;
  return out;
}

/** Body fat series per source: [{date, value}] sorted by date. */
function bodyFatSeries(body, settings) {
  const dates = [...new Set(body.measurements.filter(m => ['waist', 'neck', 'hips'].includes(m.kind)).map(m => m.date))].sort();
  const tape = dates.map(d => {
    const l = latestBy(body.measurements, d);
    // Only count a tape reading when waist and neck were measured within two weeks of each other.
    if (!l.waist || !l.neck || Math.abs(daysBetween(l.waist.date, l.neck.date)) > 14) return null;
    const v = navyBodyFat(settings.sex, settings.height_cm, l.waist.value, l.neck.value, l.hips?.value);
    return v == null ? null : { date: d, value: v };
  }).filter(Boolean);
  return {
    tape,
    scale: body.scale.map(s => ({ date: s.date, value: s.body_fat })),
    manual: body.measurements.filter(m => m.kind === 'body_fat').map(m => ({ date: m.date, value: m.value })),
  };
}
function pickSource(series, pref) {
  if (pref !== 'auto' && series[pref]?.length) return pref;
  const last = (k) => series[k][series[k].length - 1]?.date || '';
  return ['tape', 'manual', 'scale'].filter(k => series[k].length).sort((a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0))[0] || null;
}
const SOURCE_LABEL = { tape: 'Tape estimate', scale: 'Smart scale', manual: 'Entered by hand' };

/* ---------- measurements ---------- */

async function renderMeasurements(root) {
  root.replaceChildren(loading());
  await loadSummary();
  const { settings, model } = state;
  const body = await get('body');
  const refresh = () => renderMeasurements(root);
  const today = todayISO();
  const latest = latestBy(body.measurements.filter(m => PART[m.kind]));

  const series = bodyFatSeries(body, settings);
  const source = pickSource(series, settings.body_fat_source || 'auto');
  const bfSeries = source ? series[source] : [];
  const bfNow = bfSeries[bfSeries.length - 1] || null;
  const since = bfSeries.find(x => x.date >= addDays(today, -90));
  const bfChange = bfNow && since && since !== bfNow ? bfNow.value - since.value : null;
  const trendKg = model.trendKg;
  const fatKg = bfNow && trendKg ? (trendKg * bfNow.value) / 100 : null;
  const others = Object.entries(series).filter(([k, v]) => k !== source && v.length).map(([k, v]) => `${SOURCE_LABEL[k]} ${fmt1(v[v.length - 1].value)}% (${relDayLc(v[v.length - 1].date)})`);

  const comp = h('section', { class: 'card body-comp', 'aria-label': 'Body composition' },
    h('div', { class: 'card-head', style: { alignItems: 'flex-end' } },
      h('span', { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { class: 'small on-deep-muted' }, 'Body fat'),
        h('span', { class: 'num', style: { fontSize: '52px' } }, bfNow ? fmt1(bfNow.value) : '-', h('span', { class: 'unit' }, '%'))),
      bfChange != null ? h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingBottom: '6px' } },
        h('span', { class: 'num', style: { fontSize: '22px', color: 'var(--brand-orange)' } }, `${bfChange > 0 ? '+' : '−'}${fmt1(Math.abs(bfChange))} pts`),
        h('span', { class: 'small on-deep-muted' }, `since ${shortDate(since.date).split(', ').slice(1).join(', ')}`)) : null),
    h('div', { class: 'grid-3 comp-grid' },
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '22px' } }, fatKg != null ? fmtW(trendKg - fatKg) : '-', h('span', { class: 'unit' }, ` ${wUnit()}`)), h('span', { class: 'label' }, 'Lean mass')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '22px' } }, fatKg != null ? fmtW(fatKg) : '-', h('span', { class: 'unit' }, ` ${wUnit()}`)), h('span', { class: 'label' }, 'Fat mass')),
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '22px' } }, latest.waist ? (latest.waist.value / settings.height_cm).toFixed(2) : '-'), h('span', { class: 'label' }, 'Waist to height'))),
    h('p', { class: 'small on-deep-muted' }, bfNow
      ? `${SOURCE_LABEL[source]}, ${relDayLc(bfNow.date)}.${others.length ? ` Also: ${others.join('; ')}.` : ''}${source === 'tape' ? ' Estimated from waist and neck' + (settings.sex === 'female' ? ' and hips' : '') + ' (US Navy method).' : ''}`
      : 'Measure your waist and neck, connect a smart scale, or enter a body fat reading to see your composition.'),
    Object.values(series).filter(v => v.length).length > 1 ? h('div', { class: 'segmented on-deep', role: 'tablist', 'aria-label': 'Body fat source' },
      [['auto', 'Latest'], ['tape', 'Tape'], ['scale', 'Scale'], ['manual', 'Manual']].filter(([k]) => k === 'auto' || series[k].length).map(([k, l]) =>
        h('button', { role: 'tab', 'aria-selected': String((settings.body_fat_source || 'auto') === k), onclick: async () => {
          try { await post('settings', { body_fat_source: k }); markStale(); refresh(); } catch (e) { toast(e.message, 'error'); }
        } }, l))) : null);

  // Chart of the selected measurement.
  const rows = body.measurements.filter(m => m.kind === selectedPart);
  const recent = rows.filter(m => m.date >= addDays(today, -182));
  const pts = recent.length >= 2 ? recent : rows;
  const chartCard = h('section', { class: 'card', 'aria-label': `${PART[selectedPart]} over time` },
    h('div', { class: 'card-head' }, h('h2', null, PART[selectedPart]), h('span', { class: 'small muted' }, pts.length > 1 ? `${pts === recent ? 'Last 6 months' : 'All time'}, tap a row to switch` : 'Tap a row below to switch')),
    pts.length > 1 ? chart({ n: pts.length, w: 640, h: 160, lines: [{ values: pts.map(m => toLen(m.value)), color: 'var(--primary)', endDot: true }], dots: [{ values: pts.map(m => toLen(m.value)), color: 'var(--primary)', r: 4 }],
      xLabels: dateTicks(pts.map(m => m.date), Math.min(3, pts.length)), yFormat: (v) => fmt1(v),
      label: `${PART[selectedPart]} from ${fmtLen(pts[0].value)} to ${fmtLen(pts[pts.length - 1].value)} ${lenUnit()}` })
      : h('p', { class: 'note' }, rows.length ? 'Measure again to see a trend.' : `No ${PART[selectedPart].toLowerCase()} measurements yet.`));

  const lastDate = Object.values(latest).map(m => m.date).sort().pop();
  const table = h('section', { class: 'card', 'aria-label': 'All measurements', style: { gap: 0 } },
    h('div', { class: 'meas-row head' }, h('span', null, lastDate ? `Latest (${relDayLc(lastDate)})` : 'Latest'), h('span', null, lenUnit() === 'in' ? 'Inches' : 'cm'), h('span', null, '30 days')),
    ...BODY_PARTS.map(([k, label]) => {
      const cur = latest[k];
      const hist = body.measurements.filter(m => m.kind === k);
      const ref = cur ? [...hist].reverse().find(m => m.date <= addDays(cur.date, -30)) || (hist[0] !== cur ? hist[0] : null) : null;
      const d = cur && ref ? cur.value - ref.value : null;
      const shown = d == null ? null : fmtLenDiff(d);
      const good = shown == null || shown === '0' ? null : SHRINK_GOOD.has(k) ? d < 0 : null;
      return h('button', { class: 'meas-row' + (k === selectedPart ? ' sel' : ''), 'aria-pressed': String(k === selectedPart), onclick: () => { selectedPart = k; refresh(); } },
        h('span', null, label),
        h('span', { class: 'v' }, cur ? fmtLen(cur.value) : '-'),
        h('span', { class: 'd', style: { color: good == null ? 'var(--muted)' : good ? 'var(--green)' : 'var(--red)' } }, shown ?? ''));
    }));

  root.replaceChildren(
    pageHead('Measurements and photos', 'Body', [h('button', { class: 'btn sm primary', onclick: () => openMeasureSheet({ onDone: refresh }) }, 'Log measurements')]),
    h('div', { class: 'stack' },
      bodySwitch('measure'),
      h('div', { class: 'row' },
        h('div', { class: 'grow-2 stack' }, comp, chartCard),
        h('div', { class: 'grow-3 stack' }, table,
          h('p', { class: 'note small' }, 'Measure first thing in the morning, relaxed, at the same spot each time. Arms flexed at the peak; thighs midway between hip and knee; waist at the navel.')))));
}

/** Enter a set of measurements for one day. Exported for the + button. */
export async function openMeasureSheet({ onDone } = {}) {
  await loadSummary();
  let body;
  try { body = await get('body'); } catch (e) { toast(e.message, 'error'); return; }
  const last = latestBy(body.measurements);
  const dateIn = h('input', { class: 'input', type: 'date', id: 'mb-date', value: todayISO(), max: todayISO() });
  const inputs = {};
  const field = (k, label, ph, unit) => {
    inputs[k] = h('input', { id: `mb-${k}`, inputmode: 'decimal', placeholder: ph, autocomplete: 'off' });
    return h('label', { class: 'field', for: `mb-${k}` }, `${label}${unit ? ` (${unit})` : ''}`, inputs[k]);
  };
  const s = openSheet({
    title: 'Log measurements',
    tall: true,
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const values = {};
      for (const [k, el] of Object.entries(inputs)) {
        const raw = el.value.trim().replace(',', '.');
        if (raw === '') continue;
        values[k] = k === 'body_fat' ? +raw : fromLen(raw);
      }
      if (!Object.keys(values).length) { toast('Enter at least one measurement', 'error'); return; }
      try { await post('measurements/save_many', { date: dateIn.value, values }); s.close(); toast('Measurements saved'); onDone?.(); }
      catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'mb-date' }, 'Date', dateIn),
      h('p', { class: 'note small' }, `Leave anything you didn't measure blank. Grey numbers are your last values, in ${imperial() ? 'inches' : 'centimeters'}.`),
      h('div', { class: 'grid-2' }, BODY_PARTS.slice(0, 5).map(([k, l]) => field(k, l, last[k] ? fmtLen(last[k].value) : '', ''))),
      h('div', { class: 'grid-2' }, BODY_PARTS.slice(5).map(([k, l]) => field(k, l, last[k] ? fmtLen(last[k].value) : '', ''))),
      field('body_fat', 'Body fat', last.body_fat ? fmt1(last.body_fat.value) : '', '%'),
      h('p', { class: 'note small', style: { marginTop: '-6px' } }, 'Body fat is optional: from calipers, a DEXA scan or another device. A connected smart scale fills it in on its own.'),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save')),
  });
}

/* ---------- photos ---------- */

async function renderPhotos(root) {
  root.replaceChildren(loading());
  await loadSummary();
  const { model } = state;
  const [{ photos }, body] = await Promise.all([get('photos'), get('body')]);
  const refresh = () => renderPhotos(root);
  const today = todayISO();
  const byDate = {};
  for (const p of photos) (byDate[p.date] ??= {})[p.pose] = p;
  const dates = Object.keys(byDate).sort().reverse();
  const todays = byDate[today] || {};
  const lastSet = dates.find(d => d < today);
  const trendOn = Object.fromEntries(model.series.map(s => [s.date, s.trend]));
  const waistOn = (d) => latestBy(body.measurements.filter(m => m.kind === 'waist'), d).waist;
  const lastOf = (pose) => photos.find(p => p.pose === pose && p.date < today) || photos.find(p => p.pose === pose);

  const slot = ([pose, label]) => {
    const p = todays[pose];
    return h('button', { class: 'photo-slot' + (p ? ' has' : ''), 'aria-label': p ? `${label} photo taken today. Retake` : `Take a ${label.toLowerCase()} photo`,
      onclick: () => openCamera({ pose, date: today, photos, onDone: refresh }) },
      p ? h('img', { src: photoUrl(p.id, true), alt: '' }) : icon('camera', 26),
      h('span', null, p ? `${label} ✓` : label));
  };
  const todayCard = h('section', { class: 'card', 'aria-label': "Today's photos" },
    h('div', { class: 'card-head' }, h('h2', null, "Today's photos"), h('span', { class: 'small muted' }, lastSet ? `Last set ${daysBetween(lastSet, today)} day${daysBetween(lastSet, today) === 1 ? '' : 's'} ago` : 'Your first set')),
    h('div', { class: 'grid-3' }, POSES.map(slot)),
    h('p', { class: 'note small' }, 'A faint outline of your last photo shows in the camera so you can match the pose and distance. Same light and time of day works best.'),
    h('label', { class: 'btn sm ghost file-btn', style: { alignSelf: 'flex-start' } }, 'Add from your photo library',
      h('input', { type: 'file', accept: 'image/*', class: 'sr', onchange: (e) => { const f = e.target.files?.[0]; if (f) pickFromLibrary(f, today, refresh); } })));

  const sets = dates.map(d => {
    const tr = trendOn[d], w = waistOn(d);
    return h('section', { class: 'card', 'aria-label': `Photos from ${shortDate(d)}`, style: { gap: '10px' } },
      h('div', { class: 'card-head' }, h('span', { class: 'num', style: { fontSize: '20px', fontWeight: 600 } }, shortDate(d)),
        h('span', { class: 'small muted' }, [tr ? `${fmtW(tr)} ${wUnit()} trend` : null, w ? `waist ${fmtLen(w.value)}` : null].filter(Boolean).join(', '))),
      h('div', { class: 'grid-3' }, POSES.map(([pose, label]) => {
        const p = byDate[d][pose];
        return p ? h('button', { class: 'photo-tile', 'aria-label': `${label} photo, ${shortDate(d)}. Open`, onclick: () => viewPhoto(p, refresh) },
          h('img', { src: photoUrl(p.id, true), alt: '', loading: 'lazy' }), h('span', { class: 'pose-tag' }, label))
          : h('span', { class: 'photo-tile empty', 'aria-hidden': 'true' }, h('span', { class: 'pose-tag' }, label));
      })));
  });

  root.replaceChildren(
    pageHead('Measurements and photos', 'Body', dates.length > 1 ? [h('a', { class: 'btn sm', href: '#/body/compare' }, 'Compare')] : []),
    h('div', { class: 'stack' },
      bodySwitch('photos'),
      todayCard,
      h('div', { class: 'photo-sets' }, sets),
      h('p', { class: 'note small privacy-note' }, icon('lock', 16), 'Photos are stored on your own server in a private folder, shown only after you sign in, and left out of the data download.')));
}

function viewPhoto(p, onChange) {
  const s = openSheet({
    title: `${POSES.find(x => x[0] === p.pose)[1]}, ${shortDate(p.date)}`,
    tall: true,
    body: h('div', { class: 'stack' },
      h('img', { class: 'photo-full', src: photoUrl(p.id), alt: `${p.pose} progress photo from ${shortDate(p.date)}` }),
      h('div', { class: 'grid-2' },
        h('a', { class: 'btn', href: `#/body/compare?b=${p.date}&pose=${p.pose}`, onclick: () => s.close() }, 'Compare'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmSheet('Delete this photo?', 'It is removed from your server.'))) return;
          await post('photos/delete', { id: p.id }); s.close(); toast('Photo deleted'); onChange?.();
        } }, 'Delete'))),
  });
}

/* ---------- capture ---------- */

/** Resize to fit `max` on the long side and encode as JPEG (this also drops location and camera data). */
function encode(source, w, h0, max, quality = 0.86, mirror = false) {
  const k = Math.min(1, max / Math.max(w, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h0 * k);
  const ctx = c.getContext('2d');
  if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

async function upload(date, pose, source, w, h0) {
  const data = encode(source, w, h0, 1600);
  const thumb = encode(source, w, h0, 420, 0.8);
  return post('photos/upload', { date, pose, data, thumb });
}

function pickFromLibrary(file, date, onDone) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const posePick = openSheet({
      title: 'Which pose?',
      body: h('div', { class: 'stack' },
        h('img', { src: url, alt: '', class: 'photo-full', style: { maxHeight: '45vh' } }),
        h('label', { class: 'field', for: 'pl-date' }, 'Date taken', h('input', { class: 'input', type: 'date', id: 'pl-date', value: date, max: todayISO() })),
        h('div', { class: 'grid-3' }, POSES.map(([pose, label]) => h('button', { class: 'btn', onclick: async (e) => {
          e.target.disabled = true;
          try { await upload(posePick.el.querySelector('#pl-date').value, pose, img, img.naturalWidth, img.naturalHeight); posePick.close(); toast('Photo saved'); onDone?.(); }
          catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
        } }, label)))),
      onClose: () => URL.revokeObjectURL(url),
    });
  };
  img.onerror = () => { toast("That file couldn't be opened as a photo", 'error'); URL.revokeObjectURL(url); };
  img.src = url;
}

/** Full-screen camera with a ghost of the last photo for the same pose. */
export function openCamera({ pose = 'front', date = todayISO(), photos = null, onDone } = {}) {
  let facing = 'environment';
  let stream = null;
  let timer = 0;
  let current = pose;
  let all = photos;
  const taken = new Set();
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const ghost = h('img', { class: 'ghost', alt: '' });
  const count = h('div', { class: 'cam-count', 'aria-live': 'assertive' });
  const status = h('p', { class: 'scan-status' }, 'Starting the camera…');
  const poseBar = h('div', { class: 'cam-poses', role: 'tablist', 'aria-label': 'Pose' });
  const timerBtn = h('button', { class: 'scan-round', 'aria-label': 'Self-timer off', onclick: () => {
    timer = timer === 0 ? 3 : timer === 3 ? 10 : 0;
    timerBtn.setAttribute('aria-label', timer ? `Self-timer ${timer} seconds` : 'Self-timer off');
    timerBtn.replaceChildren(timer ? h('span', { style: { font: '700 15px var(--body)' } }, `${timer}s`) : icon('timer'));
    timerBtn.setAttribute('aria-pressed', String(!!timer));
  } }, icon('timer'));
  const stage = h('div', { class: 'cam-stage' }, video, ghost, count);
  const shutter = h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: () => capture() });
  const fileIn = h('input', { type: 'file', accept: 'image/*', class: 'sr', onchange: (e) => { const f = e.target.files?.[0]; if (f) { close(); pickFromLibrary(f, date, onDone); } } });
  const overlay = h('div', { class: 'scanner-full camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Progress photo camera' },
    h('div', { class: 'scan-top' },
      h('button', { class: 'scan-round', 'aria-label': 'Close camera', onclick: () => close() }, icon('close')),
      poseBar,
      h('button', { class: 'scan-round', 'aria-label': 'Switch camera', onclick: () => { facing = facing === 'user' ? 'environment' : 'user'; start(); } }, icon('sync'))),
    stage, status,
    h('div', { class: 'cam-controls' },
      h('label', { class: 'scan-round', 'aria-label': 'Choose from your photo library' }, icon('image'), fileIn),
      shutter, timerBtn));

  const drawPoses = () => poseBar.replaceChildren(...POSES.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === current), onclick: () => { current = k; drawPoses(); setGhost(); } },
    taken.has(k) ? `${l} ✓` : l)));
  const setGhost = () => {
    const last = all && (all.find(p => p.pose === current && p.date < date) || all.find(p => p.pose === current));
    ghost.hidden = !last;
    if (last) ghost.src = photoUrl(last.id);
    status.textContent = last ? `Line yourself up with the outline from ${shortDate(last.date)}.` : `${POSES.find(p => p[0] === current)[1]} photo. Stand a few steps back, arms slightly out.`;
  };
  const stop = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const start = async () => {
    stop();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => {});
      stage.classList.toggle('mirror', facing === 'user');
      setGhost();
    } catch {
      status.textContent = "The camera isn't available. Allow camera access, or choose a photo from your library.";
      shutter.disabled = true;
    }
  };
  const capture = async () => {
    if (!video.videoWidth) return;
    shutter.disabled = true;
    for (let s = timer; s > 0; s--) { count.textContent = String(s); navigator.vibrate?.(30); await new Promise(r => setTimeout(r, 1000)); }
    count.textContent = '';
    stage.classList.add('flash');
    setTimeout(() => stage.classList.remove('flash'), 180);
    try {
      // Saved the way others see you, so front-camera shots aren't mirrored.
      const data = encode(video, video.videoWidth, video.videoHeight, 1600);
      const thumb = encode(video, video.videoWidth, video.videoHeight, 420, 0.8);
      const r = await post('photos/upload', { date, pose: current, data, thumb });
      taken.add(current);
      all = [r.photo, ...(all || []).filter(p => !(p.date === date && p.pose === current))];
      toast(`${POSES.find(p => p[0] === current)[1]} photo saved`);
      const next = POSES.map(p => p[0]).find(p => !taken.has(p));
      if (next) { current = next; drawPoses(); setGhost(); } else { close(); return; }
    } catch (e) { toast(e.message, 'error'); }
    shutter.disabled = false;
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { stop(); overlay.remove(); document.removeEventListener('keydown', onKey); if (taken.size) onDone?.(); };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  drawPoses();
  (async () => { if (!all) { try { all = (await get('photos')).photos; } catch { all = []; } } setGhost(); })();
  start();
}

/* ---------- compare ---------- */

async function renderCompare(root) {
  root.replaceChildren(loading());
  await loadSummary();
  const { model, settings } = state;
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [{ photos }, body] = await Promise.all([get('photos'), get('body')]);
  const pose = POSES.some(p => p[0] === q.get('pose')) ? q.get('pose') : 'front';
  const mode = q.get('mode') === 'slide' ? 'slide' : 'split';
  const dates = [...new Set(photos.filter(p => p.pose === pose).map(p => p.date))].sort();
  const go = (patch) => {
    const n = new URLSearchParams({ pose, mode, a: aDate || '', b: bDate || '', ...patch });
    location.hash = `#/body/compare?${n}`;
  };
  let bDate = dates.includes(q.get('b')) ? q.get('b') : dates[dates.length - 1];
  let aDate = dates.includes(q.get('a')) && q.get('a') !== bDate ? q.get('a') : dates.find(d => d !== bDate) || null;
  if (aDate && bDate && aDate > bDate) [aDate, bDate] = [bDate, aDate];
  const photoOn = (d) => photos.find(p => p.pose === pose && p.date === d);

  const head = pageHead('Progress photos', 'Compare',
    aDate && bDate ? [h('button', { class: 'btn sm', onclick: () => shareComparison(photoOn(aDate), photoOn(bDate)) }, 'Save image')] : null);
  const controls = h('div', { class: 'compare-controls' },
    h('div', { class: 'segmented big', role: 'tablist', 'aria-label': 'Pose' }, POSES.map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === pose), onclick: () => go({ pose: k, a: '', b: '' }) }, l))),
    h('div', { class: 'segmented big', role: 'tablist', 'aria-label': 'View' }, [['split', 'Side by side'], ['slide', 'Slider']].map(([k, l]) => h('button', { role: 'tab', 'aria-selected': String(k === mode), onclick: () => go({ mode: k }) }, l))));

  if (dates.length < 2) {
    root.replaceChildren(head, h('div', { class: 'stack' }, controls, h('section', { class: 'card' }, h('p', { class: 'note' }, `Take ${dates.length ? 'another' : 'two'} ${pose} photo${dates.length ? '' : 's'} on different days to compare them.`),
      h('a', { class: 'btn primary', href: '#/body/photos', style: { alignSelf: 'flex-start' } }, 'Go to photos'))));
    return;
  }
  const dateSel = (which, value) => h('select', { class: 'input', 'aria-label': which === 'a' ? 'Earlier date' : 'Later date', onchange: (e) => go({ [which]: e.target.value }) },
    dates.map(d => h('option', { value: d, selected: d === value }, shortDate(d))));
  const pa = photoOn(aDate), pb = photoOn(bDate);
  let viewer;
  if (mode === 'split') {
    viewer = h('div', { class: 'compare-split' },
      h('figure', null, h('img', { src: photoUrl(pa.id), alt: `${pose} photo, ${shortDate(aDate)}` }), dateSel('a', aDate)),
      h('figure', null, h('img', { src: photoUrl(pb.id), alt: `${pose} photo, ${shortDate(bDate)}` }), dateSel('b', bDate)));
  } else {
    const top = h('img', { src: photoUrl(pb.id), alt: `${pose} photo, ${shortDate(bDate)}`, class: 'top' });
    const range = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': `Slide between ${shortDate(aDate)} and ${shortDate(bDate)}`,
      oninput: (e) => { top.style.clipPath = `inset(0 0 0 ${e.target.value}%)`; bar.style.left = `${e.target.value}%`; } });
    const bar = h('i', { class: 'slide-bar', style: { left: '50%' } });
    top.style.clipPath = 'inset(0 0 0 50%)';
    viewer = h('div', { class: 'stack' },
      h('div', { class: 'compare-slide' }, h('img', { src: photoUrl(pa.id), alt: `${pose} photo, ${shortDate(aDate)}` }), top, bar,
        h('span', { class: 'pose-tag left' }, shortDate(aDate).split(', ').slice(1).join(', ')), h('span', { class: 'pose-tag right' }, shortDate(bDate).split(', ').slice(1).join(', '))),
      range, h('div', { class: 'grid-2' }, dateSel('a', aDate), dateSel('b', bDate)));
  }

  // What changed between the two dates.
  const trendOn = (d) => { const s = model.series.filter(x => x.date <= d && x.trend != null).pop(); return s?.trend ?? null; };
  const at = (kind, d) => latestBy(body.measurements.filter(m => m.kind === kind), d)[kind]?.value ?? null;
  const series = bodyFatSeries(body, settings);
  const src = pickSource(series, settings.body_fat_source || 'auto');
  const bfAt = (d) => (src ? [...series[src]].reverse().find(x => x.date <= d)?.value ?? null : null);
  const wa = trendOn(aDate), wb = trendOn(bDate), ba = bfAt(aDate), bb = bfAt(bDate);
  const stat = (v, label, good) => h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '26px', color: good == null ? 'inherit' : good ? 'var(--green)' : 'inherit' } }, v), h('span', { class: 'label', style: { fontSize: '13px' } }, label));
  const sgn = (d, f) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${f(Math.abs(d))}`;
  const lean = (w, bf) => (w != null && bf != null ? w * (1 - bf / 100) : null);
  const goalLose = settings.goal?.type === 'lose';
  const stats = h('section', { class: 'card', 'aria-label': 'Between these dates' },
    h('div', { class: 'card-head' }, h('h2', null, 'Between these dates'), h('span', { class: 'small muted' }, `${Math.round(daysBetween(aDate, bDate) / 7)} weeks`)),
    h('div', { class: 'grid-2', style: { gap: '14px 10px' } },
      wa != null && wb != null ? stat(`${sgn(toDisplayW(wb) - toDisplayW(wa), fmt1)} ${wUnit()}`, `Trend weight, ${fmtW(wa)} to ${fmtW(wb)}`, goalLose ? wb < wa : null) : null,
      at('waist', aDate) != null && at('waist', bDate) != null ? stat(`${sgn(toLen(at('waist', bDate)) - toLen(at('waist', aDate)), (v) => fmtLen(v * (imperial() ? 2.54 : 1)))} ${lenUnit()}`, `Waist, ${fmtLen(at('waist', aDate))} to ${fmtLen(at('waist', bDate))}`, at('waist', bDate) < at('waist', aDate)) : null,
      ba != null && bb != null ? stat(`${sgn(bb - ba, fmt1)} pts`, `Body fat, ${fmt1(ba)}% to ${fmt1(bb)}%`, bb < ba) : null,
      lean(wa, ba) != null && lean(wb, bb) != null ? stat(`${sgn(toDisplayW(lean(wb, bb)) - toDisplayW(lean(wa, ba)), fmt1)} ${wUnit()}`, 'Lean mass', lean(wb, bb) >= lean(wa, ba)) : null));

  root.replaceChildren(head, h('div', { class: 'stack', style: { maxWidth: '760px' } }, controls, viewer, stats));
}

/** Two photos side by side with their dates, as one image to save or share. */
async function shareComparison(a, b) {
  try {
    const load = (p) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = photoUrl(p.id); });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const H = 1200, wa = Math.round(ia.naturalWidth * H / ia.naturalHeight), wb = Math.round(ib.naturalWidth * H / ib.naturalHeight);
    const c = document.createElement('canvas');
    c.width = wa + wb + 24; c.height = H + 90;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(ia, 0, 0, wa, H); ctx.drawImage(ib, wa + 24, 0, wb, H);
    ctx.fillStyle = '#16202B'; ctx.font = '600 44px Barlow, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(shortDate(a.date), wa / 2, H + 62); ctx.fillText(shortDate(b.date), wa + 24 + wb / 2, H + 62);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    const file = new File([blob], `progress-${a.date}-${b.date}.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: file.name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { if (e?.name !== 'AbortError') toast("Couldn't make the image", 'error'); }
}

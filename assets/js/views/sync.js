// Settings > Reminders and sync: push reminders, the smart scale Shortcut and database backups.
import { h, icon, fmt0, fmt1, timeAgo, relDay, openSheet, toast, confirmSheet, relDayLc } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, markStale, fmtW, wUnit } from '../store.js';
import { pageHead, loading } from '../components.js';
import { pushSupport, currentSubscription, enablePush, disablePush } from '../push.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtTime = (hhmm) => { const [hh, mm] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, hh, mm).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(); };
const size = (b) => (b > 1048576 ? `${fmt1(b / 1048576)} MB` : `${fmt0(b / 1024)} KB`);

export async function render(root) {
  root.replaceChildren(loading());
  await loadSummary(true);
  const [st, scale, bk, sub] = await Promise.all([get('reminders/status'), get('sync/status'), get('backups'), currentSubscription()]);
  const refresh = () => render(root);
  const r = st.reminders;
  const support = pushSupport();
  const onHere = !!sub && support.permission === 'granted';

  const save = async (patch) => {
    try { await post('settings', { reminders: patch }); markStale(); }
    catch (e) { toast(e.message, 'error'); refresh(); }
  };
  const timeIn = (key, value, label) => h('input', { type: 'time', class: 'input time-in', value, 'aria-label': label, onchange: (e) => { if (e.target.value) save({ [key]: { time: e.target.value } }); } });
  const dayIn = (key, value, label) => h('select', { class: 'input time-in', 'aria-label': label, onchange: (e) => save({ [key]: { weekday: +e.target.value } }) },
    DAYS.map((d, i) => h('option', { value: i, selected: i === value }, d)));
  const row = (key, title, sub, controls) => h('div', { class: 'rem-row' },
    h('span', { class: 'main' }, h('span', { class: 'title' }, title), h('span', { class: 'small muted' }, sub)),
    h('span', { class: 'rem-ctl' }, controls,
      h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: r[key].on, 'aria-label': `${title} reminder`, onchange: (e) => save({ [key]: { on: e.target.checked } }) })));

  const pushState = onHere ? h('span', { class: 'badge ok' }, 'On for this device')
    : !support.ok ? h('span', { class: 'badge' }, 'Not available here') : h('span', { class: 'badge' }, 'Off on this device');
  const pushBtn = onHere
    ? h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { const x = await post('push/test', {}); toast(`Test sent to ${x.sent} device${x.sent === 1 ? '' : 's'}`); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'Send a test'),
        h('button', { class: 'btn sm ghost', onclick: async () => { await disablePush(); toast('Reminders off on this device'); refresh(); } }, 'Turn off here'))
    : support.ok ? h('button', { class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: async (e) => {
        e.target.disabled = true;
        try { await enablePush(); toast('Reminders are on'); refresh(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, icon('bell', 18), 'Turn on reminders')
      : h('p', { class: 'banner info' }, support.reason === 'ios-browser' ? 'On iPhone, open Farrell Fitness from your Home Screen (Share > Add to Home Screen in Safari), then turn reminders on there.' : "This browser can't show notifications. Try the installed app or Chrome.");

  const reminders = h('section', { class: 'card', 'aria-label': 'Reminders' },
    h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, 'Reminders'), pushState),
    pushBtn,
    st.devices > (onHere ? 1 : 0) ? h('p', { class: 'small muted' }, `Also on ${st.devices - (onHere ? 1 : 0)} other device${st.devices - (onHere ? 1 : 0) === 1 ? '' : 's'}.`) : null,
    h('div', { class: 'rem-list' },
      row('weigh_in', 'Weigh in', `${fmtTime(r.weigh_in.time)}, if you haven't yet`, timeIn('weigh_in', r.weigh_in.time, 'Weigh-in reminder time')),
      row('meds', 'Meds and supplements', 'At each dose time on your list', h('a', { class: 'small', href: '#/health/meds' }, 'Times')),
      row('food', 'Finish logging food', `${fmtTime(r.food.time)}, if fewer than ${r.food.min_meals} meals are logged`, timeIn('food', r.food.time, 'Food reminder time')),
      row('photos', 'Progress photos', `${DAYS[r.photos.weekday]}s, ${fmtTime(r.photos.time)}`, h('span', { class: 'two' }, dayIn('photos', r.photos.weekday, 'Photo day'), timeIn('photos', r.photos.time, 'Photo time'))),
      row('report', 'Weekly report', `${DAYS[r.report.weekday]}s, ${fmtTime(r.report.time)}`, h('span', { class: 'two' }, dayIn('report', r.report.weekday, 'Report day'), timeIn('report', r.report.time, 'Report time'))),
      row('checkin', 'Check-in ready', `Morning of your check-in day, ${fmtTime(r.checkin.time)}`, timeIn('checkin', r.checkin.time, 'Check-in reminder time'))),
    h('p', { class: 'tiny muted' }, 'Reminders skip themselves when the thing is already done. They come from your server, so they reach every device you turned them on for.'),
    !st.scheduler_ok ? h('p', { class: 'banner' }, st.last_tick_at ? `The server's scheduled task last ran ${timeAgo(st.last_tick_at)}. Reminders and backups need it running every 15 minutes.`
      : 'Reminders and nightly backups need one scheduled task (cron job) on the server. The setup guide in the project has the line to add in cPanel.') : null);

  // Smart scale.
  const scaleCard = h('section', { class: 'card', 'aria-label': 'Smart scale' },
    h('div', { class: 'card-head' }, h('h2', null, 'Smart scale'), h('span', { class: 'small muted' }, 'via Apple Health')),
    scale.last ? h('div', { class: 'scale-status' },
      h('span', { class: 'more-ic dark', 'aria-hidden': 'true' }, icon('weight')),
      h('span', { class: 'main' }, h('span', { class: 'title' }, `Last sync ${scale.last_used_at ? timeAgo(scale.last_used_at) : relDayLc(scale.last.date)}`),
        h('span', { class: 'small muted' }, `${fmtW(scale.last.weight_kg)} ${wUnit()}${scale.last.body_fat ? `, body fat ${fmt1(scale.last.body_fat)}%` : ''} for ${relDayLc(scale.last.date)}. ${scale.count} weigh-in${scale.count === 1 ? '' : 's'} received.`)))
      : h('p', { class: 'note' }, scale.has_key ? 'Set up, waiting for the first weigh-in.' : 'Send weigh-ins from a smart scale (Eufy, Withings, Renpho or any scale that writes to Apple Health) here automatically.'),
    h('ol', { class: 'steps' },
      h('li', null, 'In your scale\'s app, turn on Apple Health sync (EufyLife: Me > Apple Health).'),
      h('li', null, 'Build the Farrell Fitness Shortcut with the steps on the next screen. It reads your latest weight and body fat from Health.'),
      h('li', null, 'Add an automation in Shortcuts to run it each morning or when you close your scale app.')),
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn primary', onclick: () => shortcutSheet(scale, refresh) }, scale.has_key ? 'Shortcut steps' : 'Set up the Shortcut'),
      scale.has_key ? h('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmSheet('Reset the sync key?', 'The Shortcut stops working until you paste in the new key.', 'Reset'))) return;
        await post('sync/revoke', {}); toast('Sync key removed'); refresh();
      } }, 'Reset key') : h('span')));

  // Backups.
  const ago = bk.last ? Math.round((Date.now() / 1000 - bk.last.created_at) / 3600) : null;
  const healthy = bk.last && ago < 36;
  const backups = h('section', { class: 'card', 'aria-label': 'Backups' },
    h('div', { class: 'card-head', style: { alignItems: 'center' } }, h('h2', null, 'Backups'), h('span', { class: 'badge' + (healthy ? ' ok' : '') }, healthy ? 'Healthy' : bk.last ? 'Overdue' : 'None yet')),
    h('p', { class: 'note' }, 'Every night after 3 am the database is saved to a private folder on your server. The last 30 days are kept, plus one from each of the last 6 months.'),
    h('div', { class: 'kv' }, h('span', null, 'Last backup'), h('span', { style: { fontWeight: 600 } }, bk.last ? `${relDay(bk.last.date)}, ${new Date(bk.last.created_at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}, ${size(bk.last.size)}` : 'Not yet')),
    h('div', { class: 'kv' }, h('span', null, 'Kept'), h('span', { style: { fontWeight: 600 } }, `${bk.nightly} recent, ${bk.count - bk.nightly} monthly`)),
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await post('backups/run', {}); toast('Backup saved'); refresh(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; } } }, 'Back up now'),
      bk.last ? h('a', { class: 'btn', href: 'api/?r=backups/download&name=latest', download: bk.last.name }, 'Download latest') : h('span')),
    h('p', { class: 'tiny muted' }, bk.driver === 'sqlite' ? 'Backups are a compressed copy of the database file.' : 'Backups are compressed SQL files. To restore one, import it in cPanel > phpMyAdmin. Progress photos are files on the server and aren\'t included.'));

  root.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('a', { href: '#/settings', class: 'back-link' }, icon('left', 18), 'Settings'), h('h1', null, 'Reminders and sync'))),
    h('div', { class: 'stack', style: { maxWidth: '760px' } }, reminders, scaleCard, backups));
}

function copyBtn(text, label) {
  return h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast(`${label} copied`); } catch { toast('Copy failed. Press and hold to select it instead.', 'error'); }
  } }, `Copy ${label.toLowerCase()}`);
}

/** Step-by-step Shortcut setup. Makes a key the first time and shows it once. */
async function shortcutSheet(status, onDone) {
  let key = null;
  if (!status.has_key) {
    try { key = (await post('sync/key', {})).key; } catch (e) { toast(e.message, 'error'); return; }
  }
  openSheet({
    title: 'Scale Shortcut',
    tall: true,
    onClose: onDone,
    body: h('div', { class: 'stack' },
      h('p', { class: 'note' }, 'On your iPhone, open the Shortcuts app and make a new shortcut called "Farrell weigh-in". Add these actions in order:'),
      h('ol', { class: 'steps big' },
        h('li', null, h('strong', null, 'Find Health Samples'), ' where Type is Weight. Sort by Start Date, Latest First, Limit 1.'),
        h('li', null, h('strong', null, 'Get Details of Health Samples'), ': Value. Add a second one for Unit, and a third for Start Date.'),
        h('li', null, h('strong', null, 'Find Health Samples'), ' where Type is Body Fat Percentage, Latest First, Limit 1, then ', h('strong', null, 'Get Details'), ': Value. (Skip this if your scale has no body fat.)'),
        h('li', null, h('strong', null, 'Get Contents of URL'), ' with the address below. Tap Show More: Method POST, Request Body JSON, and add these fields:',
          h('ul', { class: 'json-fields' },
            h('li', null, h('code', null, 'key'), ' (Text): your sync key below'),
            h('li', null, h('code', null, 'weight'), ' (Number): the weight Value'),
            h('li', null, h('code', null, 'unit'), ' (Text): the Unit'),
            h('li', null, h('code', null, 'date'), ' (Text): the Start Date'),
            h('li', null, h('code', null, 'body_fat'), ' (Number): the body fat Value'))),
        h('li', null, 'Optional: ', h('strong', null, 'Show Result'), ' with the Contents of URL, to see "Saved 195.8 lb for 2026-10-25".')),
      h('div', { class: 'copy-box' }, h('span', { class: 'tiny muted' }, 'Address'), h('code', null, status.endpoint), copyBtn(status.endpoint, 'Address')),
      key ? h('div', { class: 'copy-box key' }, h('span', { class: 'tiny muted' }, 'Sync key (shown once, keep it private)'), h('code', null, key), copyBtn(key, 'Key'))
        : h('p', { class: 'banner info' }, 'Your sync key was shown when it was made. If you no longer have it, close this, tap Reset key, then open these steps again for a new one.'),
      h('p', { class: 'note' }, 'Then in Shortcuts, open Automation > New Automation > Time of Day (for example 9:00 am daily) or App > your scale app > Is Closed. Choose Run Immediately and pick "Farrell weigh-in".'),
      h('p', { class: 'note small' }, 'Running it twice is harmless: each day keeps its newest reading. A weigh-in from the scale replaces one you typed in for the same day.')),
  });
}

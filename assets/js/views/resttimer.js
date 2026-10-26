// Settings > Rest timer: default rest, the tone, vibration and the locked-phone notification.
import { h, icon, toast } from '../ui.js';
import { post } from '../api.js';
import { state, loadSummary } from '../store.js';
import { pageHead } from '../components.js';
import { TONES, alarmSettings, playTone } from '../restalarm.js';
import { currentSubscription, pushSupport } from '../push.js';

export async function render(root) {
  await loadSummary();
  const a = alarmSettings();
  let rest = state.settings.rest_seconds || 120;
  const sub = await currentSubscription();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const save = async (patch) => {
    try {
      const s = await post('settings', patch);
      state.settings = s.settings || { ...state.settings, ...patch, rest_alarm: { ...state.settings.rest_alarm, ...(patch.rest_alarm || {}) } };
    } catch (e) { toast(e.message, 'error'); }
  };
  const setAlarm = (k, v) => { a[k] = v; save({ rest_alarm: { [k]: v } }); };

  const restNum = h('span', { class: 'num rest-len', 'aria-live': 'polite' });
  const drawRest = () => { restNum.textContent = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`; };
  drawRest();
  let saveTimer = null;
  const bump = (d) => { rest = Math.max(15, Math.min(600, rest + d)); drawRest(); clearTimeout(saveTimer); saveTimer = setTimeout(() => save({ rest_seconds: rest }), 500); };

  const toggle = (key, title, sub) => h('label', { class: 'set-row-line' },
    h('span', { class: 'main' }, h('span', { class: 'title' }, title), h('span', { class: 'small muted' }, sub)),
    h('input', { type: 'checkbox', role: 'switch', class: 'switch', checked: a[key], onchange: (e) => setAlarm(key, e.target.checked) }));

  const notifySub = !pushSupport().ok ? (ios ? 'Open the app from the Home Screen icon to use this' : 'Not available in this browser')
    : sub ? 'Reminders are on for this device' : 'Turn on reminders for this device in Reminders and sync';

  const preview = h('section', { class: 'card lock-preview', 'aria-label': 'On a locked phone' },
    h('span', { class: 'eyebrow-orange' }, 'On a locked phone'),
    h('div', { class: 'note-card' },
      h('img', { src: 'icons/icon-v2-192.png', alt: '', width: 38, height: 38 }),
      h('span', { class: 'main' },
        h('span', { class: 'note-top' }, h('b', null, 'Farrell Fitness'), h('span', null, 'now')),
        h('b', null, 'Rest over'),
        h('span', null, 'Bench press set 3, 210 × 6. Tap to go back to Upper A.'))),
    h('span', { class: 'small', style: { color: 'var(--on-deep-muted)' } }, "Plays your phone's notification sound. The tone below plays while the app is open."));

  const timer = h('section', { class: 'card', 'aria-label': 'Timer', style: { gap: 0, paddingTop: '6px', paddingBottom: '6px' } },
    h('div', { class: 'set-row-line' },
      h('span', { class: 'main' }, h('span', { class: 'title' }, 'Default rest'), h('span', { class: 'small muted' }, 'Starts when you tick a set')),
      h('span', { class: 'stepper' },
        h('button', { class: 'icon-btn bordered', 'aria-label': '15 seconds less', onclick: () => bump(-15) }, icon('minus', 18)),
        restNum,
        h('button', { class: 'icon-btn bordered', 'aria-label': '15 seconds more', onclick: () => bump(15) }, icon('plus', 18)))),
    toggle('sound', 'Play a tone', 'When rest ends, with the app open'),
    toggle('vibrate', 'Vibrate', ios ? "iPhone web apps can't vibrate, so this only applies on Android" : 'Where the phone supports it'),
    toggle('notify', 'Notify when the phone is locked', notifySub),
    !sub && pushSupport().ok ? h('a', { class: 'btn sm', href: '#/settings/sync', style: { alignSelf: 'flex-start', margin: '4px 0 8px' } }, 'Reminders and sync') : null);

  const vol = h('input', { id: 'rt-vol', type: 'range', min: 0, max: 100, value: Math.round(a.volume * 100), class: 'range',
    onchange: (e) => { setAlarm('volume', +e.target.value / 100); playTone(a.tone, a.volume); } });
  const tones = h('section', { class: 'card', 'aria-label': 'Tone', style: { gap: 0 } },
    h('h2', { style: { marginBottom: '4px' } }, 'Tone'),
    h('div', { role: 'radiogroup', 'aria-label': 'Tone' }, TONES.map(([k, name, desc]) => h('div', { class: 'set-row-line' },
      h('input', { type: 'radio', name: 'rt-tone', id: `rt-${k}`, checked: a.tone === k, class: 'radio', onchange: () => { setAlarm('tone', k); playTone(k, a.volume); } }),
      h('label', { for: `rt-${k}`, class: 'main' }, h('span', { class: 'title' }, name), h('span', { class: 'small muted' }, desc)),
      h('button', { class: 'icon-btn bordered', 'aria-label': `Play ${name}`, onclick: () => playTone(k, a.volume) }, icon('play', 16))))),
    h('label', { for: 'rt-vol', class: 'title', style: { padding: '12px 0 4px', borderTop: '1px solid var(--rule)', fontWeight: 600 } }, 'Volume'),
    vol);

  root.replaceChildren(
    pageHead('Settings', 'Rest timer'),
    h('div', { class: 'stack', style: { maxWidth: '640px' } }, preview, timer, tones));
}

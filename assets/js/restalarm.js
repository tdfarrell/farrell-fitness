// The rest timer's alarm: a tone and vibration when the app is open, and a push notification for
// when the phone is locked. iPhone web apps can't play sound in the background or vibrate at all,
// so on a locked iPhone the push (with the phone's own notification sound) is what you hear.
import { post } from './api.js';
import { state } from './store.js';
import { currentSubscription } from './push.js';

export const TONES = [
  ['bell', 'Bell', 'Two soft rings'],
  ['whistle', 'Whistle', 'One short coach whistle'],
  ['beeps', 'Beeps', 'Three quick beeps'],
  ['chime', 'Chime', 'Rising three-note chime'],
];

export function alarmSettings() {
  return { sound: true, tone: 'bell', volume: 0.7, vibrate: true, notify: true, ...(state.settings?.rest_alarm || {}) };
}

let ctx = null;
/** Browsers only allow sound after a tap, so this runs on the tap that starts a rest. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') ctx.resume();
    // A silent blip keeps iOS from muting the context later.
    const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
    const o = ctx.createOscillator(); o.connect(g); o.start(); o.stop(ctx.currentTime + 0.01);
  } catch { /* no audio */ }
}

/** Plays a tone (synthesized, so nothing to download). */
export function playTone(tone = alarmSettings().tone, volume = alarmSettings().volume) {
  unlockAudio();
  if (!ctx || volume <= 0) return;
  const t0 = ctx.currentTime + 0.02;
  const out = ctx.createGain(); out.gain.value = Math.min(1, volume) * 0.6; out.connect(ctx.destination);
  const note = (freq, start, dur, type = 'sine', bend = 0) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0 + start);
    if (bend) o.frequency.linearRampToValueAtTime(freq + bend, t0 + start + dur);
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(1, t0 + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    o.connect(g); g.connect(out); o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
  };
  switch (tone) {
    case 'whistle': note(2300, 0, 0.18, 'sine', 300); note(2600, 0.2, 0.45, 'sine', -150); break;
    case 'beeps': [0, 0.22, 0.44].forEach(s => note(1320, s, 0.14, 'square')); break;
    case 'chime': note(784, 0, 0.5); note(988, 0.18, 0.5); note(1319, 0.36, 0.9); break;
    default: note(880, 0, 1.1); note(1760, 0, 0.6); note(880, 0.55, 1.2); note(1760, 0.55, 0.7); // bell
  }
}

/** When rest ends with the app open. `muted` is the per-workout speaker button. */
export function ring(muted) {
  const a = alarmSettings();
  if (a.sound && !muted) playTone(a.tone, a.volume);
  if (a.vibrate) navigator.vibrate?.([300, 150, 300]);
}

/** Asks the server to push to this device when the rest ends. Quietly does nothing if it can't. */
export async function scheduleRestPush(seconds, { title = 'Rest over', body = '' } = {}) {
  if (!alarmSettings().notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub) return;
  try { await post('rest/schedule', { endpoint: sub.endpoint, in_seconds: Math.round(seconds), title, body, url: '#/train/active' }); } catch { /* best effort */ }
}

export async function cancelRestPush() {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  try { await post('rest/cancel', { endpoint: sub.endpoint }); } catch { /* best effort */ }
}

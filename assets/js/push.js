// Turning reminders on for this device: ask permission, subscribe through the service worker,
// and send the subscription to the server. On iPhone this only works in the app added to the
// Home Screen (iOS 16.4 or later).
import { get, post } from './api.js';

export function pushSupport() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: ios && !standalone ? 'ios-browser' : 'unsupported' };
  }
  if (ios && !standalone) return { ok: false, reason: 'ios-browser' };
  return { ok: true, permission: Notification.permission };
}

const fromB64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
};

async function registration() {
  const reg = await navigator.serviceWorker.ready;
  return reg;
}

/** Is this device subscribed right now? */
export async function currentSubscription() {
  if (!pushSupport().ok) return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'This device';
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : '';
  return br ? `${os}, ${br}` : os;
}

/** Ask permission and subscribe. Throws with a readable message if it can't. */
export async function enablePush() {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.reason === 'ios-browser' ? 'On iPhone, add the app to your Home Screen first, then turn reminders on from there.' : "This browser doesn't support notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this app in your phone or browser settings, then try again.');
  const { public_key } = await get('push/key');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(public_key) });
  const json = sub.toJSON();
  return post('push/subscribe', { endpoint: json.endpoint, keys: json.keys, device: deviceName() });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch {}
    return post('push/unsubscribe', { endpoint });
  }
  return null;
}

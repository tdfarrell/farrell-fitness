// API client. Writes made while offline are queued and replayed when the connection returns.

const OUTBOX_KEY = 'ff_outbox_v1';
const QUEUEABLE = new Set(['diary/add', 'diary/delete', 'weights/save', 'workouts/save', 'day/status', 'cardio/save', 'habits/log', 'glucose/save', 'journal/save']);

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function raw(route, { method = 'GET', body, query } = {}) {
  const qs = new URLSearchParams({ r: route, ...(query || {}) });
  const res = await fetch(`api/?${qs}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-FF-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401 && route !== 'auth/login') onUnauthorized();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export function get(route, query) { return raw(route, { query }); }

export async function post(route, body = {}) {
  try {
    return await raw(route, { method: 'POST', body });
  } catch (e) {
    if (!(e instanceof ApiError) && QUEUEABLE.has(route)) {
      queue(route, body);
      return { queued: true };
    }
    throw e;
  }
}

function readOutbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return []; } }
function writeOutbox(items) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* storage full or blocked */ } }
function queue(route, body) { writeOutbox([...readOutbox(), { route, body, at: Date.now() }]); }
export function outboxCount() { return readOutbox().length; }

export async function flushOutbox() {
  const items = readOutbox();
  if (!items.length) return 0;
  const left = [];
  let sent = 0;
  for (const it of items) {
    try { await raw(it.route, { method: 'POST', body: it.body }); sent++; }
    catch (e) { if (!(e instanceof ApiError)) left.push(it); /* server rejected: drop it */ }
  }
  writeOutbox(left);
  return sent;
}

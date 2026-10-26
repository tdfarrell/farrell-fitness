// Timed sets (planks, hangs, carries): reading and writing hold times, and the hold timer's clock.
// The timer is kept as timestamps, so it stays right when the app is in the background or reloads.

export const COUNT_IN = 3; // seconds to get into position
export const SWITCH = 5;   // seconds to change sides

/** 75 → "1:15". */
export function fmtHold(sec) {
  if (sec == null || !Number.isFinite(+sec)) return '';
  const s = Math.max(0, Math.round(+sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What was typed into a time box, in seconds: "1:30" or "130" is 90, "45" is 45. Null when blank or unreadable. */
export function parseHold(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  let sec;
  const m = t.match(/^(\d{1,3}):(\d{1,2})$/);
  if (m) sec = +m[1] * 60 + +m[2];
  else if (/^\d{1,5}$/.test(t)) {
    const n = +t;
    sec = t.length >= 3 ? Math.floor(n / 100) * 60 + (n % 100) : n;
  } else return null;
  return sec > 0 && sec <= 36000 ? sec : null;
}

/** A new timer. `sides` runs left, a short switch, then right. */
export function newHold({ now, target = null, sides = false, side = null }) {
  return { started: now, pausedMs: 0, pauseAt: null, lead: COUNT_IN, target: target || null, sides, side: sides ? 'L' : side, begun: false, rang: false, logged: {} };
}

/** Seconds since the timer (or the current side) started, leaving out pauses. */
export function elapsed(h, now) {
  return (now - h.started - h.pausedMs - (h.pauseAt ? now - h.pauseAt : 0)) / 1000;
}

/** Where the timer is now: counting in, switching sides, or holding (with time held and time left). */
export function holdNow(h, now) {
  const t = elapsed(h, now);
  if (t < h.lead) return { phase: h.sides && h.side === 'R' ? 'switch' : 'countin', left: h.lead - t, held: 0 };
  const held = t - h.lead;
  return { phase: 'hold', held, left: h.target ? h.target - held : null, over: !!h.target && held >= h.target };
}

/**
 * Ends the current side at `at`: logs it and, on the left side of an each-side hold, moves to the switch.
 * Returns events: {type: 'log', side, sec} and then {type: 'done'} when the set is finished.
 */
export function stopHold(h, at) {
  const { phase, held } = holdNow(h, at);
  if (phase !== 'hold') return h.sides && h.side === 'R' ? [{ type: 'done' }] : [{ type: 'cancel' }];
  const sec = Math.max(1, Math.round(h.target && h.sides ? Math.min(held, h.target) : held));
  const ev = [{ type: 'log', side: h.side, sec }];
  h.logged[h.side || 'one'] = sec;
  if (h.sides && h.side === 'L') {
    Object.assign(h, { side: 'R', started: at, pausedMs: 0, pauseAt: null, lead: SWITCH, begun: false, rang: false });
  } else ev.push({ type: 'done' });
  return ev;
}

/**
 * Moves the clock on to `now` and returns what happened since the last call, in order:
 * {type: 'go'} when the count-in or switch ends, {type: 'target', side} when the target is reached,
 * then for each-side holds the log and switch (each side stops at its target). A plain hold keeps
 * counting past its target until you stop it.
 */
export function advanceHold(h, now) {
  const ev = [];
  if (h.pauseAt) return ev;
  for (let guard = 0; guard < 6; guard++) {
    const t = elapsed(h, now);
    if (t < h.lead) break;
    if (!h.begun) { h.begun = true; ev.push({ type: 'go', side: h.side }); }
    const held = t - h.lead;
    if (!h.target || held < h.target || h.rang) break;
    h.rang = true;
    ev.push({ type: 'target', side: h.side });
    if (!h.sides) break;
    // The moment the target was reached; the next side (if any) starts from there.
    const at = now - (held - h.target) * 1000;
    const out = stopHold(h, at);
    ev.push(...out);
    if (out.some(e => e.type === 'done')) { h.finished = true; break; }
  }
  return ev;
}

export function pauseHold(h, now) { if (!h.pauseAt) h.pauseAt = now; }
export function resumeHold(h, now) { if (h.pauseAt) { h.pausedMs += now - h.pauseAt; h.pauseAt = null; } }
/** Skips the rest of the count-in or switch. */
export function skipLead(h, now) { const t = elapsed(h, now); if (t < h.lead) h.lead = Math.max(0, t); }
/** Adds 15 seconds to the target (or sets one 15 s past now when there wasn't one). */
export function extendHold(h, now, by = 15) {
  const { held, phase } = holdNow(h, now);
  const base = h.target && h.target > held ? h.target : (phase === 'hold' ? Math.ceil(held) : 0);
  h.target = base + by;
  h.rang = false;
}

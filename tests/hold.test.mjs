// Hold timer and time parsing for timed sets.
//   node tests/hold.test.mjs
import assert from 'node:assert/strict';
import { fmtHold, parseHold, newHold, holdNow, advanceHold, stopHold, pauseHold, resumeHold, skipLead, extendHold, COUNT_IN, SWITCH } from '../assets/js/hold.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
const S = 1000;

t('formats seconds as m:ss', () => {
  assert.equal(fmtHold(45), '0:45'); assert.equal(fmtHold(90), '1:30'); assert.equal(fmtHold(600), '10:00'); assert.equal(fmtHold(null), '');
});

t('reads typed times', () => {
  assert.equal(parseHold('45'), 45); assert.equal(parseHold('90'), 90); assert.equal(parseHold('130'), 90); assert.equal(parseHold('1:30'), 90);
  assert.equal(parseHold('0:45'), 45); assert.equal(parseHold('100'), 60); assert.equal(parseHold(' 2:05 '), 125);
  assert.equal(parseHold(''), null); assert.equal(parseHold('abc'), null); assert.equal(parseHold('0'), null); assert.equal(parseHold('1.5'), null);
});

t('counts in, then holds, rings at the target and keeps counting', () => {
  const h = newHold({ now: 0, target: 45 });
  assert.equal(holdNow(h, 1 * S).phase, 'countin');
  assert.deepEqual(advanceHold(h, 2 * S), []);
  assert.deepEqual(advanceHold(h, (COUNT_IN + 1) * S).map(e => e.type), ['go']);
  assert.equal(Math.round(holdNow(h, (COUNT_IN + 10) * S).left), 35);
  assert.deepEqual(advanceHold(h, (COUNT_IN + 45.2) * S).map(e => e.type), ['target']);
  assert.deepEqual(advanceHold(h, (COUNT_IN + 50) * S), [], 'rings once');
  const now = holdNow(h, (COUNT_IN + 52) * S);
  assert.ok(now.over && Math.round(now.held) === 52);
  const ev = stopHold(h, (COUNT_IN + 52) * S);
  assert.deepEqual(ev, [{ type: 'log', side: null, sec: 52 }, { type: 'done' }]);
});

t('pauses leave time out', () => {
  const h = newHold({ now: 0, target: 30 });
  advanceHold(h, 5 * S);
  pauseHold(h, 10 * S);
  assert.deepEqual(advanceHold(h, 100 * S), [], 'nothing happens while paused');
  resumeHold(h, 40 * S);
  assert.equal(Math.round(holdNow(h, 41 * S).held), 8);
});

t('stopping during the count-in cancels; skipping starts the hold now', () => {
  const h = newHold({ now: 0, target: 30 });
  assert.deepEqual(stopHold(h, 1 * S), [{ type: 'cancel' }]);
  const g = newHold({ now: 0, target: 30 });
  skipLead(g, 1 * S);
  assert.equal(holdNow(g, 1 * S).phase, 'hold');
  assert.equal(Math.round(holdNow(g, 11 * S).held), 10);
});

t('each side: left to target, switch, right to target', () => {
  const h = newHold({ now: 0, target: 30, sides: true });
  const a = advanceHold(h, (COUNT_IN + 30.1) * S);
  assert.deepEqual(a.map(e => e.type), ['go', 'target', 'log']);
  assert.deepEqual(a[2], { type: 'log', side: 'L', sec: 30 });
  assert.equal(holdNow(h, (COUNT_IN + 32) * S).phase, 'switch');
  const b = advanceHold(h, (COUNT_IN + 30 + SWITCH + 30.5) * S);
  assert.deepEqual(b.map(e => e.type), ['go', 'target', 'log', 'done']);
  assert.equal(b[2].side, 'R');
});

t('each side catches up after the phone was locked the whole time', () => {
  const h = newHold({ now: 0, target: 20, sides: true });
  const ev = advanceHold(h, 300 * S);
  assert.deepEqual(ev.filter(e => e.type === 'log').map(e => [e.side, e.sec]), [['L', 20], ['R', 20]]);
  assert.ok(ev.at(-1).type === 'done');
});

t('each side without a target: stop moves to the right side', () => {
  const h = newHold({ now: 0, sides: true });
  advanceHold(h, 10 * S);
  assert.deepEqual(stopHold(h, (COUNT_IN + 25) * S), [{ type: 'log', side: 'L', sec: 25 }]);
  assert.equal(h.side, 'R');
  advanceHold(h, (COUNT_IN + 25 + SWITCH + 1) * S);
  assert.deepEqual(stopHold(h, (COUNT_IN + 25 + SWITCH + 22) * S), [{ type: 'log', side: 'R', sec: 22 }, { type: 'done' }]);
});

t('+15 s moves the target and rings again', () => {
  const h = newHold({ now: 0, target: 30 });
  advanceHold(h, (COUNT_IN + 31) * S);
  extendHold(h, (COUNT_IN + 31) * S);
  assert.equal(h.target, 46);
  assert.deepEqual(advanceHold(h, (COUNT_IN + 48) * S).map(e => e.type), ['target']);
  const g = newHold({ now: 0, target: 30 });
  extendHold(g, (COUNT_IN + 10) * S);
  assert.equal(g.target, 45);
});

console.log(`\n${n} hold timer checks passed`);

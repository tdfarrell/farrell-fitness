// The + button: one place to log anything.
import { h, icon, openSheet, todayISO } from './ui.js';
import { state, loadSummary } from './store.js';
import { openAddFood } from './views/food.js';
import { openWeightSheet } from './views/weight.js';
import { openMedsSheet, openGlucoseSheet } from './views/health.js';
import { guessMeal } from './views/today.js';

const changed = () => window.dispatchEvent(new Event('ff:changed'));

const ORANGE = '#E06A1F', NAVY = '#00275B', GREEN = '#23874F', RED = '#C9302C';

export function openQuickAddMenu() {
  const go = (hash) => { location.hash = hash; };
  const actions = [
    ['Food', 'food', ORANGE, async () => { await loadSummary(); openAddFood({ date: todayISO(), meal: guessMeal(state.settings), onDone: changed }); }],
    ['Scan', 'barcode', ORANGE, async () => { await loadSummary(); openAddFood({ date: todayISO(), meal: guessMeal(state.settings), onDone: changed, scan: true }); }],
    ['Weigh in', 'weight', NAVY, () => openWeightSheet({ onDone: changed })],
    ['Workout', 'train', NAVY, () => go('#/train/new')],
    ['Cardio', 'pulse', NAVY, () => go('#/train/cardio/new')],
    ['Meds', 'pill', GREEN, () => openMedsSheet({ onDone: changed })],
    ['Glucose', 'drop', RED, () => openGlucoseSheet({ onDone: changed })],
    ['Journal', 'journal', GREEN, () => go('#/journal')],
  ];
  const s = openSheet({
    title: 'Add',
    label: 'Add to your log',
    body: h('div', { class: 'quick-grid' }, actions.map(([label, ic, color, run]) =>
      h('button', { type: 'button', onclick: () => { s.close(); run(); } },
        h('span', { class: 'qi', style: { background: color }, 'aria-hidden': 'true' }, icon(ic)), label))),
  });
}

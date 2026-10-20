// Pieces shared by several screens.
import { h, icon, fmt0, fmt1, hoursMin, timeAgo, recoveryColor } from './ui.js';

export function pageHead(eyebrow, title, actions) {
  return h('header', { class: 'page-head' },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      eyebrow ? h('span', { class: 'eyebrow' }, eyebrow) : null,
      h('h1', null, title)),
    actions ? h('div', { class: 'actions' }, actions) : null);
}

/** Plate-colored bar of calories eaten by macro against the calorie target. */
export function plateBar(totals, targetKcal) {
  const p = totals.protein * 4, c = totals.carbs * 4, f = totals.fat * 9;
  const denom = Math.max(targetKcal || 1, p + c + f);
  const pct = (v) => `${((v / denom) * 100).toFixed(1)}%`;
  const over = totals.kcal > targetKcal;
  return h('div', {
    class: 'plate-bar' + (over ? ' over' : ''), role: 'img',
    'aria-label': `Calories eaten by macro: protein ${fmt0(p)}, carbs ${fmt0(c)}, fat ${fmt0(f)}, target ${fmt0(targetKcal)}`,
  },
    h('div', { class: 'c-protein', style: { width: pct(p) } }),
    h('div', { class: 'c-carbs', style: { width: pct(c) } }),
    h('div', { class: 'c-fat', style: { width: pct(f) } }));
}

export function macroCols(totals, targets) {
  const one = (name, cls, eaten, target) => h('div', { class: 'macro' },
    h('span', { class: 'name' }, h('span', { class: 'swatch ' + cls, 'aria-hidden': 'true' }), name),
    h('span', { class: 'num' }, fmt0(eaten), h('span', { class: 'unit' }, ` / ${fmt0(target)} g`)),
    h('div', { class: 'meter', role: 'img', 'aria-label': `${name} ${fmt0(eaten)} of ${fmt0(target)} grams` },
      h('div', { class: cls, style: { width: `${Math.min(100, (eaten / (target || 1)) * 100)}%` } })));
  return h('div', { class: 'grid-3' },
    one('Protein', 'c-protein', totals.protein, targets.protein),
    one('Carbs', 'c-carbs', totals.carbs, targets.carbs),
    one('Fat', 'c-fat', totals.fat, targets.fat));
}

export function calorieCard(totals, targets, extra = {}) {
  const left = targets.kcal - totals.kcal;
  return h('section', { class: 'card pad-lg ' + (extra.class || ''), 'aria-label': 'Calories' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { class: 'muted', style: { fontSize: '14px', fontWeight: 500 } }, left >= 0 ? 'Calories left' : 'Calories over'),
        h('span', { class: 'hero-num' + (left < 0 ? ' over' : '') }, fmt0(Math.abs(left)))),
      extra.expenditure != null
        ? h('div', { class: 'desk-only', style: { gap: '28px', paddingBottom: '8px' } },
            stat(fmt0(totals.kcal), 'eaten'), stat(fmt0(targets.kcal), 'target'), stat(fmt0(extra.expenditure), 'expenditure'))
        : null,
      h('div', { class: extra.expenditure != null ? 'phone-only' : '', style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', paddingBottom: '6px' } },
        h('span', { class: 'num', style: { fontSize: '22px', fontWeight: 600 } }, fmt0(totals.kcal), h('span', { class: 'muted', style: { fontWeight: 500 } }, ` / ${fmt0(targets.kcal)}`)),
        h('span', { class: 'small muted' }, 'eaten of target'))),
    plateBar(totals, targets.kcal),
    macroCols(totals, targets),
    extra.action || null);
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'num' }, value), h('span', { class: 'label', style: { fontSize: '13px' } }, label));
}

export function whoopCard(w, status, avgRecovery) {
  if (!w) {
    return h('section', { class: 'card whoop-card', 'aria-label': 'WHOOP' },
      h('h2', null, 'Recovery and sleep'),
      status?.connected
        ? h('p', { class: 'note' }, 'No WHOOP data for today yet. It appears after WHOOP scores your sleep.')
        : h('p', { class: 'note' }, 'Connect WHOOP in Settings to see recovery, HRV, sleep and strain here.'),
      status?.connected ? null : h('a', { class: 'btn sm', href: '#/settings', style: { alignSelf: 'flex-start' } }, 'Connect WHOOP'));
  }
  const sleepTotal = (w.sleep_light || 0) + (w.sleep_deep || 0) + (w.sleep_rem || 0);
  const pctNeed = w.sleep_need_hours ? Math.round((w.sleep_hours / w.sleep_need_hours) * 100) : w.sleep_perf;
  return h('section', { class: 'card whoop-card', 'aria-label': 'WHOOP' },
    h('div', { class: 'card-head' },
      h('h2', null, 'Recovery and sleep'),
      h('span', { class: 'small muted' }, `WHOOP, synced ${timeAgo(status?.last_sync_at)}`)),
    h('div', { class: 'big-recovery', style: { display: 'none', alignItems: 'flex-end', gap: '14px' } },
      h('span', { class: 'num', style: { fontSize: '80px', lineHeight: 0.88, color: w.recovery >= 67 ? 'var(--deep-green)' : recoveryColor(w.recovery) } }, w.recovery == null ? '-' : `${w.recovery}%`),
      h('span', { class: 'muted', style: { fontSize: '14px', paddingBottom: '8px' } }, avgRecovery != null ? `recovery, 7-day avg ${fmt0(avgRecovery)}%` : 'recovery')),
    h('div', { class: 'grid-4' },
      h('div', { class: 'stat phone-only' }, h('span', { class: 'num', style: { color: recoveryColor(w.recovery) } }, w.recovery == null ? '-' : `${w.recovery}%`), h('span', { class: 'label' }, 'Recovery')),
      h('div', { class: 'stat' }, h('span', { class: 'num' }, fmt0(w.hrv), h('span', { class: 'unit' }, ' ms')), h('span', { class: 'label' }, 'HRV')),
      h('div', { class: 'stat' }, h('span', { class: 'num' }, fmt0(w.rhr)), h('span', { class: 'label' }, 'Resting HR')),
      h('div', { class: 'stat' }, h('span', { class: 'num' }, w.strain == null ? '-' : fmt1(w.strain)), h('span', { class: 'label' }, 'Strain'))),
    w.sleep_hours != null ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '14px' } },
        h('span', { style: { fontWeight: 600 } }, `Sleep ${hoursMin(w.sleep_hours)}`),
        h('span', { class: 'muted' }, pctNeed != null ? `${pctNeed}% of need` : '')),
      sleepTotal ? h('div', { class: 'sleepbar', role: 'img', 'aria-label': `Sleep stages: light ${hoursMin(w.sleep_light)}, deep ${hoursMin(w.sleep_deep)}, REM ${hoursMin(w.sleep_rem)}` },
        h('div', { style: { flex: w.sleep_light || 0, background: 'var(--sleep-light)' } }),
        h('div', { style: { flex: w.sleep_deep || 0, background: 'var(--sleep-deep)' } }),
        h('div', { style: { flex: w.sleep_rem || 0, background: 'var(--sleep-rem)' } })) : null,
      sleepTotal ? h('div', { class: 'tiny muted', style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } },
        h('span', null, `Light ${hoursMin(w.sleep_light)}`), h('span', null, `Deep ${hoursMin(w.sleep_deep)}`), h('span', null, `REM ${hoursMin(w.sleep_rem)}`)) : null)
    : null);
}

export function loading() {
  return h('div', { class: 'empty', role: 'status' }, 'Loading…');
}

export function errorBox(e, retry) {
  return h('div', { class: 'stack', style: { paddingTop: '24px' } },
    h('p', { class: 'banner' }, e?.message || 'Something went wrong.'),
    retry ? h('button', { class: 'btn', onclick: retry, style: { alignSelf: 'flex-start' } }, 'Try again') : null);
}

export { icon };

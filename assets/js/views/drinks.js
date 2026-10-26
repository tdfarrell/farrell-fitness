// Drinks card on Today: water, caffeine and alcohol counters, plus their settings sheet.
import { h, icon, fmt0, fmt1, openSheet, toast, todayISO } from '../ui.js';
import { post } from '../api.js';
import { state, markStale } from '../store.js';

const OZ = 29.5735;
export const CAFFEINE = [['Coffee', 95], ['Espresso', 63], ['Cold brew', 200], ['Tea', 47], ['Energy drink', 160], ['Pre-workout', 200]];
// [name, standard drinks, kcal, carbs g]
export const ALCOHOL = [['Beer', 1, 150, 13], ['Light beer', 1, 100, 6], ['Wine', 1, 125, 4], ['Shot', 1, 100, 0], ['Cocktail', 1.5, 200, 15]];

const metric = () => state.settings?.units === 'metric';
export const fmtWater = (ml) => (metric() ? (ml >= 1000 ? `${fmt1(ml / 1000).replace('.0', '')} L` : `${fmt0(ml)} ml`) : `${fmt0(ml / OZ)} oz`);
const waterUnit = (ml) => (metric() ? `${fmt0(ml)} ml` : `${fmt0(ml / OZ)} oz`);
const clock = (unix) => new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const clock12 = (hhmm) => { const [hr, mi] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(hr, mi, 0, 0); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: mi ? '2-digit' : undefined }).toLowerCase(); };

/** The card. `data` is the drinks/day response; `onChange` re-renders whatever else depends on drinks. */
export function drinksCard(date, data, { onChange, onRefresh, inRow = false } = {}) {
  const cfg = state.settings.drinks;
  if (!cfg.show?.length) return null;
  const card = h('section', { class: 'card' + (inRow ? ' grow-2' : ''), 'aria-label': 'Drinks', style: { gap: '4px' } });
  let d = data;

  const send = async (body) => {
    try {
      const r = await post('drinks/add', { date, ...body });
      if (r?.queued) { toast('Saved offline'); return; }
      d = r; draw();
      // Calories went into the food log, so the rest of Today needs fresh numbers.
      if (r.logged_food) { markStale(); toast(`Added ${fmt0(body.kcal)} kcal to your food log`); onRefresh?.(); return; }
      onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  const undo = async (id) => {
    const hadFood = d.drinks.find(x => x.id === id)?.diary_entry_id;
    try {
      d = await post('drinks/delete', { id }); draw(); markStale(); toast('Removed');
      if (hadFood) onRefresh?.(); else onChange?.();
    }
    catch (e) { toast(e.message, 'error'); }
  };

  function water() {
    const goal = cfg.water_goal_ml, glass = cfg.glass_ml, have = d.totals.water;
    const n = Math.max(4, Math.min(16, Math.round(goal / glass)));
    const filled = Math.min(n, Math.floor(have / glass + 0.001));
    return h('div', { class: 'drink-block' },
      h('div', { class: 'drink-head' },
        h('span', { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { style: { fontWeight: 600 } }, 'Water'),
          h('span', { class: 'num drink-num water' }, metric() ? fmt1(have / 1000) : fmt0(have / OZ),
            h('span', { class: 'drink-of' }, metric() ? ` of ${fmt1(goal / 1000).replace('.0', '')} L` : ` of ${fmt0(goal / OZ)} oz`))),
        h('span', { class: 'drink-btns' },
          h('button', { class: 'icon-btn bordered', 'aria-label': `Remove ${waterUnit(glass)} of water`, disabled: have <= 0, onclick: () => send({ kind: 'water', amount: -glass }) }, icon('minus', 20)),
          h('button', { class: 'btn sm water-soft', onclick: () => send({ kind: 'water', amount: glass }) }, `+ ${waterUnit(glass)}`),
          h('button', { class: 'btn sm water-solid', onclick: () => send({ kind: 'water', amount: cfg.bottle_ml, label: 'Bottle' }) }, '+ Bottle'))),
      h('div', { class: 'glasses', role: 'img', 'aria-label': `${filled} of ${n} glasses` },
        Array.from({ length: n }, (_, i) => h('span', { class: i < filled ? 'on' : '' }))));
  }

  function caffeine() {
    const tot = d.totals.caffeine, limit = cfg.caffeine_limit;
    const items = d.drinks.filter(x => x.kind === 'caffeine');
    const last = items[items.length - 1];
    const [ch, cm] = cfg.caffeine_cutoff.split(':').map(Number);
    const lateLast = last && (() => { const t = new Date(last.logged_at * 1000); return t.getHours() * 60 + t.getMinutes() >= ch * 60 + cm; })();
    const over = limit && tot > limit;
    const summary = lateLast ? `${fmt0(tot)} mg, last after your ${clock12(cfg.caffeine_cutoff)} cut-off`
      : `${fmt0(tot)} mg${limit ? ` of ${fmt0(limit)}` : ''}, cut-off ${clock12(cfg.caffeine_cutoff)}`;
    return [summary, lateLast || over, h('div', { class: 'drink-block fold-body' },
      h('div', { class: 'drink-head' },
        h('span', { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { class: 'num drink-num' + (over ? ' over' : '') }, fmt0(tot), h('span', { class: 'drink-of' }, limit ? ` mg, limit ${fmt0(limit)}` : ' mg'))),
        lateLast ? h('span', { class: 'warn-tag' }, `Last at ${clock(last.logged_at)}, after your ${clock12(cfg.caffeine_cutoff)} cut-off`)
          : over ? h('span', { class: 'warn-tag' }, 'Over your daily limit') : null),
      h('div', { class: 'pills' },
        ...CAFFEINE.map(([n, mg]) => h('button', { class: 'pill', onclick: () => send({ kind: 'caffeine', amount: mg, label: n }) }, n, h('span', { class: 'muted' }, ` ${mg}`))),
        h('button', { class: 'pill', onclick: () => otherCaffeine(send) }, 'Other')),
      items.length ? undoList(items, (x) => `${x.label || 'Caffeine'} ${clock(x.logged_at)}`, undo, date) : null)];
  }

  function alcohol() {
    const items = d.drinks.filter(x => x.kind === 'alcohol');
    const cb = h('input', { type: 'checkbox', checked: cfg.alcohol_to_log, onchange: async (e) => {
      cfg.alcohol_to_log = e.target.checked;
      try { await post('settings', { drinks: { alcohol_to_log: e.target.checked } }); } catch (err) { toast(err.message, 'error'); }
    } });
    const meals = state.settings.meals;
    const meal = meals[meals.length - 1];
    const std = (v) => `${fmt1(v).replace('.0', '')} standard drink${v === 1 ? '' : 's'}`;
    const n = (v) => fmt1(v).replace('.0', '');
    const day = date === todayISO() ? 'today' : 'this day';
    const summary = `${d.totals.alcohol ? `${n(d.totals.alcohol)} ${day}` : `None ${day}`}, ${n(d.alcohol_week)} this week`;
    return [summary, false, h('div', { class: 'drink-block fold-body' },
      h('div', { class: 'drink-head' },
        h('span', { style: { display: 'flex', flexDirection: 'column' } },
          h('span', { class: 'num drink-num' }, fmt1(d.totals.alcohol).replace('.0', ''),
            h('span', { class: 'drink-of' }, ` ${d.totals.alcohol === 1 ? 'standard drink' : 'standard drinks'}, ${fmt1(d.alcohol_week).replace('.0', '')} this week`)))),
      h('div', { class: 'pills' }, ALCOHOL.map(([n, s, kcal, carbs]) => h('button', { class: 'pill', 'aria-label': `${n}, ${std(s)}, ${kcal} kcal`, onclick: () =>
        send({ kind: 'alcohol', amount: s, label: n, kcal, carbs, log_food: cfg.alcohol_to_log, meal }) }, n, h('span', { class: 'muted' }, ` ${kcal} kcal`)))),
      h('label', { class: 'check', style: { minHeight: '44px', fontSize: '14px' } }, cb, `Add the calories to my food log (${meal})`),
      items.length ? undoList(items, (x) => `${x.label || 'Drink'} ${clock(x.logged_at)}`, undo, date) : null)];
  }

  // Caffeine and alcohol fold up under water; each remembers whether it's open.
  function fold(key, name, [summary, warn, body]) {
    const open = !!foldState()[key];
    const btn = h('button', { class: 'fold-head', 'aria-expanded': String(open), onclick: () => {
      const s = foldState(); s[key] = !s[key]; saveFold(s); draw();
    } },
      h('span', { class: 'fold-name' }, name),
      h('span', { class: 'fold-sum' + (warn ? ' warn' : '') }, summary),
      icon(open ? 'up' : 'down', 18));
    return h('div', { class: 'drink-fold' }, btn, open ? body : null);
  }

  function draw() {
    const order = ['water', 'caffeine', 'alcohol'].filter(k => cfg.show.includes(k));
    card.replaceChildren(
      h('div', { class: 'card-head', style: { alignItems: 'center' } },
        h('h2', null, 'Drinks'),
        h('button', { class: 'icon-btn', 'aria-label': 'Drink settings', onclick: () => openDrinkSettings(() => onRefresh?.()) }, icon('sliders', 20))),
      ...order.map(k => (k === 'water' ? water() : fold(k, k === 'caffeine' ? 'Caffeine' : 'Alcohol', k === 'caffeine' ? caffeine() : alcohol()))));
  }
  draw();
  return card;
}

const FOLD_KEY = 'ff_drinks_open';
function foldState() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch { return {}; } }
function saveFold(s) { try { localStorage.setItem(FOLD_KEY, JSON.stringify(s)); } catch {} }

function undoList(items, text, undo, date) {
  return h('div', { class: 'undo-list' },
    h('span', { class: 'tiny muted' }, date === todayISO() ? 'Today:' : 'This day:'),
    ...items.map(x => h('button', { class: 'undo-chip', 'aria-label': `Remove ${text(x)}`, onclick: () => undo(x.id) }, text(x), icon('close', 14))));
}

function otherCaffeine(send) {
  const name = h('input', { id: 'oc-name', placeholder: 'Soda' });
  const mg = h('input', { id: 'oc-mg', inputmode: 'numeric', placeholder: '40' });
  const s = openSheet({
    title: 'Other caffeine',
    body: h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      const v = parseFloat(mg.value);
      if (!(v > 0)) { toast('Enter the caffeine in mg', 'error'); return; }
      s.close(); send({ kind: 'caffeine', amount: v, label: name.value.trim() || 'Caffeine' });
    } },
      h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'oc-name' }, 'What', name), h('label', { class: 'field', for: 'oc-mg' }, 'Caffeine (mg)', mg)),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Add')),
  });
}

export function openDrinkSettings(onSaved) {
  const cfg = state.settings.drinks;
  const toUnit = (ml) => (metric() ? Math.round(ml) : Math.round(ml / OZ));
  const fromUnit = (v) => (metric() ? v : v * OZ);
  const u = metric() ? 'ml' : 'oz';
  const num = (id, label, value) => h('label', { class: 'field', for: id }, label, h('input', { id, inputmode: 'decimal', value: String(value) }));
  const show = new Set(cfg.show);
  const s = openSheet({
    title: 'Drinks',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const v = (id) => parseFloat(f.querySelector('#' + id).value.replace(',', '.'));
      const patch = {
        water_goal_ml: fromUnit(v('dr-goal')), glass_ml: fromUnit(v('dr-glass')), bottle_ml: fromUnit(v('dr-bottle')),
        caffeine_limit: v('dr-caf') || 0, caffeine_cutoff: f.querySelector('#dr-cut').value || '14:00',
        show: ['water', 'caffeine', 'alcohol'].filter(k => f.querySelector('#dr-show-' + k).checked),
      };
      if (Object.values(patch).some(x => typeof x === 'number' && Number.isNaN(x))) { toast('Fill in every number', 'error'); return; }
      try {
        const r = await post('settings', { drinks: patch });
        state.settings = r.settings; markStale(); s.close(); toast('Saved'); onSaved?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('div', { class: 'grid-2' }, num('dr-goal', `Water goal (${u})`, toUnit(cfg.water_goal_ml)), num('dr-glass', `Glass (${u})`, toUnit(cfg.glass_ml))),
      h('div', { class: 'grid-2' }, num('dr-bottle', `Bottle (${u})`, toUnit(cfg.bottle_ml)), num('dr-caf', 'Caffeine limit (mg)', cfg.caffeine_limit)),
      h('label', { class: 'field', for: 'dr-cut' }, 'Caffeine cut-off time', h('input', { id: 'dr-cut', type: 'time', value: cfg.caffeine_cutoff })),
      h('fieldset', { class: 'plain-fieldset' },
        h('legend', { class: 'small muted' }, 'Show on Today'),
        ...[['water', 'Water'], ['caffeine', 'Caffeine'], ['alcohol', 'Alcohol']].map(([k, l]) =>
          h('label', { class: 'check', style: { minHeight: '40px' } }, h('input', { type: 'checkbox', id: 'dr-show-' + k, checked: show.has(k) }), l))),
      h('p', { class: 'note small' }, 'Add a Water goal habit in Habits and it checks itself when you reach this goal. The US limit for caffeine in healthy adults is about 400 mg a day.'),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save')),
  });
}

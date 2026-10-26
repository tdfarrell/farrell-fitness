// The "Fill my macros" sheet: what's left today, and one or two of your foods that cover it.
import { h, fmt0, openSheet, toast } from '../ui.js';
import { get, post } from '../api.js';
import { state, markStale } from '../store.js';
import { suggest } from '../fill.js';
import { amountEditor } from './food.js';

export function openFillMacros({ date, meal, remaining, onDone }) {
  const meals = state.settings?.meals || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  let mode = 'pair';
  let added = false;
  openSheet({
    title: 'Fill my macros',
    tall: true,
    onClose: () => { if (added) onDone?.(); },
    body: async (sheet) => {
      const left = h('section', { class: 'fill-left', 'aria-label': 'Left today' },
        [['kcal left', fmt0(Math.max(0, remaining.kcal)), 'var(--kcal)'], ['protein', `${fmt0(Math.max(0, remaining.protein))} g`], ['carbs', `${fmt0(Math.max(0, remaining.carbs))} g`], ['fat', `${fmt0(Math.max(0, remaining.fat))} g`]]
          .map(([l, v, c]) => h('span', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '24px', color: c || 'inherit' } }, v), h('span', { class: 'label' }, l))));
      const mealSel = h('select', { class: 'input', 'aria-label': 'Add to meal', style: { width: 'auto', height: '40px' } }, meals.map(m => h('option', { selected: m === meal }, m)));
      const modes = h('div', { class: 'pills', role: 'group', 'aria-label': 'Suggest from' });
      const list = h('div', { class: 'stack', 'aria-live': 'polite' });
      const drawModes = () => modes.replaceChildren(...[['pair', 'Up to 2 foods'], ['one', 'One food']].map(([k, l]) =>
        h('button', { class: 'pill', 'aria-pressed': String(mode === k), onclick: () => { mode = k; drawModes(); draw(); } }, l)));
      mealSel.addEventListener('change', () => { meal = mealSel.value; draw(); });

      sheet.body.append(left,
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' } },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--muted)' } }, 'Add to', mealSel), modes),
        list,
        h('p', { class: 'note small' }, 'Suggestions come from your foods and recipes, with amounts rounded to sensible portions. The fit compares the result with what you have left.'));
      drawModes();

      if (remaining.kcal < 80) {
        list.replaceChildren(h('p', { class: 'empty' }, remaining.kcal < 0 ? "You're over your calories for the day." : 'Less than 80 kcal left. Nothing to fill.'));
        return;
      }
      list.replaceChildren(h('p', { class: 'empty' }, 'Finding foods…'));
      let foods = [];
      try { foods = (await get('foods/mine')).foods; } catch (e) { list.replaceChildren(h('p', { class: 'banner' }, e.message)); return; }

      const addItems = async (items, btn) => {
        btn.disabled = true;
        try {
          for (const it of items) await post('diary/add', { date, meal, food: it.food.id, grams: it.grams, quantity: it.quantity, portion_label: it.portion_label });
          added = true; markStale();
          toast(`Added to ${meal.toLowerCase()}`);
          sheet.close();
        } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
      };

      function card(o) {
        const t = o.totals;
        const bars = [['Protein', t.protein, remaining.protein, 'var(--red)'], ['Carbs', t.carbs, remaining.carbs, 'var(--yellow)'], ['Fat', t.fat, remaining.fat, 'var(--green)']];
        const spare = bars.map(([l, v, r]) => [l, r - v]).filter(([, d]) => d >= 8).sort((a, b) => b[1] - a[1])[0];
        const why = [`${fmt0(t.kcal)} kcal.`,
          spare ? `Leaves ${fmt0(spare[1])} g ${spare[0].toLowerCase()} to spare.` : o.items.length === 1 && o.items[0].food.use_count > 2 ? `Logged ${o.items[0].food.use_count} times.` : ''].join(' ');
        const box = h('section', { class: 'fill-card', 'aria-label': o.items.map(i => i.food.name).join(' and ') });
        const addBtn = h('button', { class: 'btn primary', style: { flex: 1, height: '42px' }, onclick: () => addItems(o.items, addBtn) }, `Add to ${meal}`);
        box.append(
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' } },
            h('span', { style: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 } },
              ...o.items.map(it => h('span', { style: { fontWeight: 600 } }, it.food.name, ' ', h('span', { class: 'muted', style: { fontWeight: 500 } }, it.show))),
              h('span', { class: 'tiny muted' }, why)),
            h('span', { class: 'stat', style: { alignItems: 'flex-end', flex: 'none' } },
              h('span', { class: 'num', style: { fontSize: '22px', color: o.fit >= 90 ? 'var(--green)' : 'inherit' } }, `${o.fit}%`), h('span', { class: 'tiny muted' }, 'fit'))),
          h('div', { class: 'fill-bars', role: 'img', 'aria-label': `Protein ${fmt0(t.protein)}, carbs ${fmt0(t.carbs)}, fat ${fmt0(t.fat)} grams` },
            bars.map(([l, v, r, c]) => h('span', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
              h('span', { class: 'tiny muted' }, `${l} ${fmt0(v)} of ${fmt0(Math.max(0, r))} g`),
              h('span', { class: 'meter' }, h('div', { style: { width: `${Math.min(100, r > 0 ? (v / r) * 100 : 100)}%`, background: c } }))))),
          h('div', { style: { display: 'flex', gap: '8px' } }, addBtn,
            h('button', { class: 'btn', style: { height: '42px' }, onclick: () => adjust(o, box) }, 'Adjust')));
        return box;
      }

      function adjust(o, box) {
        box.replaceChildren(h('span', { style: { fontWeight: 600 } }, 'Change the amounts, then add each one'),
          ...o.items.map(it => h('div', { class: 'stack', style: { gap: '6px' } },
            h('span', { class: 'small' }, it.food.name),
            amountEditor(it.food, { initialGrams: it.grams, submitLabel: 'Add', onSubmit: async (amt) => {
              try { await post('diary/add', { date, meal, food: it.food.id, ...amt }); added = true; markStale(); toast(`Added ${it.food.name}`); }
              catch (e) { toast(e.message, 'error'); }
            } }))));
      }

      function draw() {
        const opts = suggest(foods, remaining, { mode });
        list.replaceChildren(...(opts.length ? opts.map(card)
          : [h('p', { class: 'empty' }, foods.length ? 'None of your foods fit what’s left. Try One food, or log something new.' : 'Log a few foods first. Suggestions come from foods you’ve used.')]));
      }
      draw();
    },
  });
}

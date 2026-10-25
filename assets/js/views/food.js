import { h, icon, fmt0, fmt1, todayISO, shortDate, relDay, openSheet, toast, confirmSheet, debounce, relDayLc } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, markStale } from '../store.js';
import { addDays } from '../tdee.js';

const OZ = 28.3495;

/* ======================= diary screen ======================= */

export async function render(root, params) {
  // #/food is the overview; #/food/diary is today's log; #/food/YYYY-MM-DD is that day's log.
  if (!params[0]) return (await import('./foodhome.js')).render(root);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? params[0] : todayISO();
  await loadSummary();
  const { targets, settings } = state;
  const meals = settings.meals;
  const data = await get('diary', { date });
  const entries = data.entries;
  const sum = (list) => list.reduce((a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const tot = sum(entries);
  const refresh = () => { markStale(); render(root, [date]); };

  const totalsCard = h('div', { class: 'card', style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px', padding: '12px 16px' } },
    [['kcal', fmt0(tot.kcal), `of ${fmt0(targets.kcal)} kcal`, 'var(--kcal)'],
     ['protein', `${fmt0(tot.protein)} g`, `of ${fmt0(targets.protein)} protein`],
     ['carbs', `${fmt0(tot.carbs)} g`, `of ${fmt0(targets.carbs)} carbs`],
     ['fat', `${fmt0(tot.fat)} g`, `of ${fmt0(targets.fat)} fat`]].map(([, v, l, c]) =>
      h('div', { class: 'stat' }, h('span', { class: 'num', style: { fontSize: '22px', color: c || 'inherit' } }, v), h('span', { class: 'label' }, l))));

  const statusLabels = { auto: 'Counted if anything is logged', complete: 'Logged completely', fasted: 'Fasted (0 kcal)', exclude: 'Left out of expenditure' };
  const statusBtn = h('button', { class: 'btn sm ghost', onclick: () => openDayStatus(date, data.status, refresh) },
    date < todayISO() ? `Day: ${statusLabels[data.status].toLowerCase()}` : 'Day options');

  const mealCards = meals.map(meal => {
    const list = entries.filter(e => e.meal === meal);
    const m = sum(list);
    return h('section', { class: 'card', 'aria-label': meal, style: { gap: '4px' } },
      h('div', { class: 'card-head', style: { alignItems: 'center' } },
        h('h2', { style: { font: '600 17px var(--body)' } }, meal),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
          h('span', { class: 'small muted' }, list.length ? `${fmt0(m.kcal)} kcal` : ''),
          h('button', { class: 'icon-btn', 'aria-label': `More options for ${meal}`, onclick: () => openMealMenu(date, meal, list.length, refresh) }, icon('more')),
          h('button', { class: 'icon-btn', 'aria-label': `Add food to ${meal}`, style: { color: 'var(--primary)' }, onclick: () => openAddFood({ date, meal, onDone: refresh }) }, icon('plus')))),
      list.length ? h('div', { class: 'list' }, list.map(e => h('button', { class: 'list-row', onclick: () => openEntry(e, meals, refresh) },
        h('div', { class: 'main' },
          h('span', { style: { fontSize: '15px' } }, e.name),
          h('span', { class: 'tiny muted' }, [e.brand, e.portion_label || (e.grams ? `${fmt0(e.grams)} g` : null), `P ${fmt0(e.protein)}  C ${fmt0(e.carbs)}  F ${fmt0(e.fat)}`].filter(Boolean).join(', '))),
        h('span', { class: 'muted', style: { fontVariantNumeric: 'tabular-nums' } }, fmt0(e.kcal)))))
        : null);
  });

  root.replaceChildren(
    h('div', { class: 'date-nav' },
      h('a', { class: 'icon-btn', href: `#/food/${addDays(date, -1)}`, 'aria-label': 'Previous day' }, icon('left')),
      h('div', { class: 'center' },
        h('h1', null, 'Food log'),
        h('span', { class: 'muted', style: { fontSize: '14px' } }, date === todayISO() ? `Today, ${shortDate(date).split(', ').slice(1).join(', ')}` : shortDate(date))),
      date < todayISO() ? h('a', { class: 'icon-btn', href: `#/food/${addDays(date, 1)}`, 'aria-label': 'Next day' }, icon('right'))
        : h('span', { style: { width: '44px' } })),
    h('div', { class: 'stack' },
      foodSwitch('diary'),
      totalsCard,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '-6px' } }, statusBtn),
      h('div', { class: 'diary-grid' }, mealCards)));
}

/** Overview | Diary | Plans switch shared by the food screens. */
export function foodSwitch(current) {
  return h('nav', { class: 'segmented big', 'aria-label': 'Food sections' },
    h('a', { href: '#/food', 'aria-current': current === 'overview' ? 'page' : null }, 'Overview'),
    h('a', { href: '#/food/diary', 'aria-current': current === 'diary' ? 'page' : null }, 'Diary'),
    h('a', { href: '#/plans', 'aria-current': current === 'plan' ? 'page' : null }, 'Plans'));
}

function openDayStatus(date, current, refresh) {
  const opts = [
    ['auto', 'Automatic', 'Counted toward your expenditure if anything is logged.'],
    ['complete', 'Logged completely', 'Count this day even if the total looks low.'],
    ['fasted', 'Fasted', 'Count this day as 0 kcal.'],
    ['exclude', 'Leave out', "You didn't log everything. Don't use this day for expenditure."],
  ];
  const s = openSheet({
    title: shortDate(date),
    body: h('div', { class: 'stack' },
      h('p', { class: 'note' }, 'How should this day count toward your expenditure estimate?'),
      h('div', { class: 'list' }, opts.map(([k, label, desc]) => h('button', { class: 'list-row', 'aria-pressed': String(current === k), onclick: async () => {
        await post('day/status', { date, status: k });
        s.close(); toast('Day updated'); refresh();
      } },
        h('div', { class: 'main' }, h('span', { class: 'title' }, label), h('span', { class: 'small muted' }, desc)),
        current === k ? h('span', { style: { color: 'var(--primary)' } }, icon('check', 20)) : null)))),
  });
}

function openMealMenu(date, meal, count, refresh) {
  const y = addDays(date, -1);
  const s = openSheet({
    title: meal,
    body: h('div', { class: 'stack' },
      h('button', { class: 'btn block', onclick: async () => {
        const r = await post('diary/copy', { from: y, to: date, meal });
        s.close(); toast(r.copied ? `Copied ${r.copied} item${r.copied > 1 ? 's' : ''} from ${relDayLc(y)}` : `Nothing logged for ${meal.toLowerCase()} ${relDayLc(y)}`);
        if (r.copied) refresh();
      } }, `Copy ${meal.toLowerCase()} from ${relDayLc(y)}`),
      h('button', { class: 'btn block', onclick: () => { s.close(); openQuickAdd({ date, meal, onDone: refresh }); } }, 'Quick add calories'),
      count ? h('button', { class: 'btn block danger', onclick: async () => {
        if (!(await confirmSheet(`Clear ${meal.toLowerCase()}?`, `This deletes all ${count} items in ${meal.toLowerCase()} for this day.`, 'Clear'))) return;
        const d = await get('diary', { date });
        for (const e of d.entries.filter(x => x.meal === meal)) await post('diary/delete', { id: e.id });
        s.close(); toast(`${meal} cleared`); refresh();
      } }, `Clear ${meal.toLowerCase()}`) : null),
  });
}

/* ======================= amount editor ======================= */

function unitOptions(food) {
  const opts = [{ label: 'g', grams: 1 }, { label: 'oz', grams: OZ }];
  for (const p of food.portions || []) opts.push({ label: p.label, grams: p.grams });
  return opts;
}

/** Amount + unit inputs with a live macro preview. Calls onSubmit({grams, quantity, portion_label}). */
export function amountEditor(food, { initialGrams, submitLabel = 'Add', onSubmit, extra }) {
  const units = unitOptions(food);
  let unitIdx = food.portions?.length ? 2 : 0;
  let amount = food.portions?.length ? 1 : 100;
  if (initialGrams) {
    const pi = units.findIndex((u, i) => i >= 2 && Math.abs(initialGrams / u.grams - Math.round(initialGrams / u.grams * 4) / 4) < 0.01);
    if (pi >= 0) { unitIdx = pi; amount = +(initialGrams / units[pi].grams).toFixed(2); }
    else { unitIdx = 0; amount = Math.round(initialGrams * 10) / 10; }
  }
  const amtIn = h('input', { class: 'input', inputmode: 'decimal', value: String(amount), 'aria-label': 'Amount', style: { width: '84px' } });
  const unitSel = h('select', { class: 'input', 'aria-label': 'Unit' }, units.map((u, i) => h('option', { value: i, selected: i === unitIdx }, u.label)));
  const preview = h('div', { class: 'small', style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } });
  const kcalOut = h('span', { class: 'num', style: { fontSize: '22px', whiteSpace: 'nowrap' } });
  const grams = () => (parseFloat(amtIn.value.replace(',', '.')) || 0) * units[+unitSel.value].grams;
  const update = () => {
    const k = grams() / 100;
    kcalOut.textContent = `${fmt0(food.kcal * k)} kcal`;
    preview.replaceChildren(
      ...[['c-protein', food.protein, 'protein'], ['c-carbs', food.carbs, 'carbs'], ['c-fat', food.fat, 'fat']].map(([c, v, n]) =>
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, h('span', { class: 'swatch ' + c, 'aria-hidden': 'true' }), `${fmt1(v * k).replace('.0', '')} g ${n}`)),
      h('span', { class: 'muted' }, `${fmt0(grams())} g`));
  };
  amtIn.addEventListener('input', update);
  unitSel.addEventListener('change', () => {
    const g = grams();
    const u = units[+unitSel.value];
    amtIn.value = u.grams === 1 ? String(Math.round(g)) : String(+(g / u.grams).toFixed(2) || 1);
    update();
  });
  update();
  const submit = h('button', { class: 'btn primary', type: 'submit', style: { height: '46px' } }, submitLabel);
  const form = h('form', { class: 'stack', style: { gap: '10px' }, onsubmit: (e) => {
    e.preventDefault();
    const g = grams();
    if (!(g > 0)) { toast('Enter an amount', 'error'); return; }
    const u = units[+unitSel.value];
    const qty = parseFloat(amtIn.value.replace(',', '.'));
    onSubmit({ grams: g, quantity: qty, portion_label: u.grams === 1 ? `${fmt0(g)} g` : `${+qty.toFixed(2)} x ${u.label}` });
  } },
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-end' } },
      h('label', { class: 'field' }, 'Amount', amtIn),
      h('label', { class: 'field', style: { flex: 1 } }, 'Unit', unitSel),
      submit),
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } }, preview, kcalOut),
    extra || null);
  return form;
}

/* ======================= add-food sheet ======================= */

/**
 * The add-food sheet. By default it adds to the food log for `date`.
 * Pass `target` ({ name, add(food, amt, meal), addQuick(quick, meal) }) to add somewhere else, such as a meal plan.
 * Pass `scan: true` to open the barcode scanner straight away.
 */
export function openAddFood({ date, meal, onDone, target = null, scan = false }) {
  const meals = state.settings?.meals || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
  let added = 0;
  const titleFor = (m) => target ? `Add to ${target.name}: ${m.toLowerCase()}` : `Add to ${m.toLowerCase()}`;
  openSheet({
    title: titleFor(meal),
    tall: true,
    onClose: () => { if (added) onDone?.(); },
    body: (sheet) => {
      let tab = 'search';
      let query = '';
      let expanded = null;
      const mealSel = h('select', { class: 'input', 'aria-label': 'Meal', style: { width: 'auto', height: '40px' } },
        meals.map(m => h('option', { selected: m === meal }, m)));
      mealSel.addEventListener('change', () => { meal = mealSel.value; sheet.setTitle(titleFor(meal)); });
      const qIn = h('input', { type: 'search', placeholder: 'Search foods', 'aria-label': 'Search foods', autocomplete: 'off', enterkeyhint: 'search' });
      const list = h('div', { class: 'list', 'aria-live': 'polite' });
      const tabs = h('div', { class: 'pills', role: 'tablist', 'aria-label': 'Food sources' });
      const drawTabs = () => tabs.replaceChildren(...[['search', 'Search'], ['recent', 'Recent'], ['mine', 'My foods'], ['recipe', 'Recipes']].map(([k, l]) =>
        h('button', { class: 'pill', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; drawTabs(); load(); } }, l)));

      const addFood = async (food, amt) => {
        try {
          const r = target ? await target.add(food, amt, meal) : await post('diary/add', { date, meal, food: food.id ? food.id : food, ...amt });
          added++; if (!target) markStale();
          toast(r?.queued ? `Saved offline: ${food.name}` : `Added ${food.name}`);
          expanded = null; draw(lastItems);
        } catch (e) { toast(e.message, 'error'); }
      };

      const row = (f) => {
        const portion = f.portions?.[0];
        const meta = [f.kind, f.brand, portion ? `${portion.label}` : 'per 100 g'].filter(Boolean).join(', ');
        const kcal = portion ? f.kcal * portion.grams / 100 : f.kcal;
        const key = `${f.source}:${f.source_id || f.id}`;
        const isOpen = expanded === key;
        const wrap = h('div', { class: 'list-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '10px' } });
        const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          h('button', { class: 'main', style: { background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }, 'aria-expanded': String(isOpen), onclick: () => { expanded = isOpen ? null : key; draw(lastItems); } },
            h('span', { class: 'title' }, f.name), h('span', { class: 'small muted' }, meta)),
          h('span', { class: 'num', style: { fontSize: '19px', fontWeight: 600, whiteSpace: 'nowrap' } }, fmt0(kcal)),
          h('button', { class: 'icon-btn', 'aria-label': `Quick add ${f.name}`, style: { border: '1px solid var(--field)', borderRadius: '22px', color: 'var(--primary)' },
            onclick: () => addFood(f, { grams: portion ? portion.grams : 100, quantity: 1, portion_label: portion ? `1 x ${portion.label}` : '100 g' }) }, icon('plus', 18)));
        wrap.append(head);
        if (isOpen) {
          const holder = h('div');
          wrap.append(holder);
          const editable = f.id && (f.source === 'custom' || f.source === 'recipe');
          const editBtn = editable ? h('button', { class: 'btn sm ghost', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => (f.source === 'recipe'
            ? openRecipeEditor({ recipe: f, onSaved: load })
            : openFoodEditor({ food: f, onSaved: load })) }, f.source === 'recipe' ? 'Edit recipe' : 'Edit food') : null;
          const show = (food) => holder.replaceChildren(amountEditor(food, { onSubmit: (amt) => addFood(food, amt), extra: editBtn }));
          if (f.source === 'usda' && !f._detailed && !f.id) {
            holder.append(h('p', { class: 'small muted' }, 'Loading serving sizes…'));
            get('foods/detail', { id: f.source_id }).then(r => { Object.assign(f, r.food, { _detailed: true, kind: f.kind }); show(f); }).catch(() => show(f));
          } else show(f);
        }
        return wrap;
      };

      let lastItems = [];
      const draw = (items, note) => {
        lastItems = items;
        list.replaceChildren(
          ...(note ? [h('p', { class: 'banner info' }, note)] : []),
          ...(items.length ? items.map(row) : [h('div', { class: 'empty' },
            tab === 'search' && query ? 'No matches. Try fewer words, or create it as your own food.'
              : tab === 'recipe' ? 'No recipes yet.' : tab === 'mine' ? 'Foods you create appear here.' : 'Foods you log appear here for quick re-adding.')]));
      };

      let seq = 0;
      const load = async () => {
        const my = ++seq;
        if (tab === 'search' && query.length >= 2) {
          list.replaceChildren(h('p', { class: 'empty' }, 'Searching…'));
          try {
            const r = await get('foods/search', { q: query });
            if (my !== seq) return;
            draw([...r.mine, ...r.results], r.error);
          } catch (e) { if (my === seq) draw([], e.message); }
        } else {
          const q = tab === 'recipe' ? { kind: 'recipe' } : tab === 'mine' ? { kind: 'custom' } : { sort: 'recent' };
          const r = await get('foods/mine', q);
          if (my === seq) draw(r.foods.slice(0, 60));
        }
      };
      qIn.addEventListener('input', debounce(() => { query = qIn.value.trim(); if (tab !== 'search') { tab = 'search'; drawTabs(); } load(); }, 350));

      const actions = h('div', { class: 'row', style: { gap: '8px' } },
        h('button', { class: 'btn sm', onclick: () => openQuickAdd({ date, meal, target, onDone: () => { added++; } }) }, 'Quick add'),
        h('button', { class: 'btn sm', onclick: () => openFoodEditor({ onSaved: (f) => { tab = 'mine'; drawTabs(); expanded = `custom:${f.source_id}`; load(); } }) }, 'Create food'),
        h('button', { class: 'btn sm', onclick: () => openRecipeEditor({ onSaved: () => { tab = 'recipe'; drawTabs(); load(); } }) }, 'New recipe'));

      sheet.body.append(
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h('label', { class: 'search' }, icon('search'), qIn),
          h('button', { class: 'icon-btn', 'aria-label': 'Scan barcode', style: { border: '1px solid var(--field)', width: '48px', height: '48px', borderRadius: '12px' },
            onclick: () => openScanner({ onFood: (f) => { tab = 'search'; drawTabs(); expanded = `${f.source}:${f.source_id || f.id}`; draw([f]); } }) }, icon('barcode'))),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, tabs, mealSel),
        list,
        actions);
      drawTabs();
      tab = 'recent'; drawTabs(); load();
      const onScanned = (f) => { tab = 'search'; drawTabs(); expanded = `${f.source}:${f.source_id || f.id}`; draw([f]); };
      if (scan) openScanner({ onFood: onScanned });
      else setTimeout(() => qIn.focus(), 50);
    },
  });
}

/* ======================= quick add, custom foods, recipes ======================= */

function numField(label, id, value = '') {
  return h('label', { class: 'field', for: id }, label, h('input', { id, inputmode: 'decimal', value }));
}
const val = (root, id) => parseFloat((root.querySelector('#' + id)?.value || '').replace(',', '.'));

export function openQuickAdd({ date, meal, onDone, target = null }) {
  const s = openSheet({
    title: 'Quick add',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const quick = { name: f.querySelector('#qa-name').value.trim() || 'Quick add', kcal: val(f, 'qa-kcal') || 0, protein: val(f, 'qa-p') || 0, carbs: val(f, 'qa-c') || 0, fat: val(f, 'qa-f') || 0 };
      if (!quick.kcal && !quick.protein && !quick.carbs && !quick.fat) { toast('Enter calories or macros', 'error'); return; }
      try {
        const r = target ? await target.addQuick(quick, meal) : await post('diary/add', { date, meal, quick });
        if (!target) markStale();
        toast(r?.queued ? 'Saved offline' : 'Added'); s.close(); onDone?.();
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'qa-name' }, 'Name', h('input', { id: 'qa-name', placeholder: 'Restaurant meal' })),
      h('div', { class: 'grid-2' }, numField('Calories', 'qa-kcal'), numField('Protein (g)', 'qa-p')),
      h('div', { class: 'grid-2' }, numField('Carbs (g)', 'qa-c'), numField('Fat (g)', 'qa-f')),
      h('p', { class: 'note small' }, 'Leave calories blank to calculate them from the macros.'),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Add')),
  });
}

/** Create or edit your own food. Values are entered per serving and stored per 100 g. */
export function openFoodEditor({ food = null, barcode = null, onSaved } = {}) {
  const serving = food?.portions?.[0] || { label: '1 serving', grams: 100 };
  const per = (k) => (food ? +(food[k] * serving.grams / 100).toFixed(1) : '');
  const s = openSheet({
    title: food ? 'Edit food' : 'Create food',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      const grams = val(f, 'cf-g');
      if (!(grams > 0)) { toast('Serving weight is required', 'error'); return; }
      const k = 100 / grams;
      const kcalIn = val(f, 'cf-kcal');
      const p = val(f, 'cf-p') || 0, c = val(f, 'cf-c') || 0, fa = val(f, 'cf-f') || 0;
      const body = { food: {
        id: food?.id, source: 'custom', source_id: food?.source_id,
        name: f.querySelector('#cf-name').value, brand: f.querySelector('#cf-brand').value,
        barcode: f.querySelector('#cf-bar').value || barcode,
        kcal: ((Number.isNaN(kcalIn) ? p * 4 + c * 4 + fa * 9 : kcalIn) * k), protein: p * k, carbs: c * k, fat: fa * k,
        fiber: Number.isNaN(val(f, 'cf-fib')) ? null : val(f, 'cf-fib') * k,
        portions: [{ label: f.querySelector('#cf-label').value || '1 serving', grams }],
      } };
      try {
        const r = await post('foods/save', body);
        toast('Food saved'); s.close(); onSaved?.(r.food);
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'cf-name' }, 'Name', h('input', { id: 'cf-name', required: true, value: food?.name || '' })),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field', for: 'cf-brand' }, 'Brand (optional)', h('input', { id: 'cf-brand', value: food?.brand || '' })),
        h('label', { class: 'field', for: 'cf-bar' }, 'Barcode (optional)', h('input', { id: 'cf-bar', inputmode: 'numeric', value: food?.barcode || barcode || '' }))),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field', for: 'cf-label' }, 'Serving name', h('input', { id: 'cf-label', value: serving.label })),
        numField('Serving weight (g)', 'cf-g', String(serving.grams))),
      h('p', { class: 'note small' }, 'Nutrition per serving, from the label:'),
      h('div', { class: 'grid-2' }, numField('Calories', 'cf-kcal', String(per('kcal'))), numField('Protein (g)', 'cf-p', String(per('protein')))),
      h('div', { class: 'grid-2' }, numField('Carbs (g)', 'cf-c', String(per('carbs'))), numField('Fat (g)', 'cf-f', String(per('fat')))),
      numField('Fiber (g, optional)', 'cf-fib', food?.fiber != null ? String(per('fiber')) : ''),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Save food'),
      food?.id ? h('button', { class: 'btn block danger', type: 'button', onclick: async () => {
        if (!(await confirmSheet('Delete food?', 'It disappears from your foods. Past log entries keep their numbers.'))) return;
        await post('foods/delete', { id: food.id }); toast('Food deleted'); s.close(); onSaved?.(null);
      } }, 'Delete food') : null),
  });
}

/** Recipe = ingredients with gram amounts, split into servings. Stored per 100 g of the whole dish. */
export function openRecipeEditor({ recipe = null, onSaved } = {}) {
  const ingredients = (recipe?.recipe?.ingredients || []).map(x => ({ ...x }));
  openSheet({
    title: recipe ? 'Edit recipe' : 'New recipe',
    tall: true,
    body: (sheet) => {
      const nameIn = h('input', { id: 'rc-name', value: recipe?.name || '', required: true });
      const servIn = h('input', { id: 'rc-serv', inputmode: 'decimal', value: String(recipe?.recipe?.servings || 4) });
      const ingList = h('div', { class: 'list' });
      const totalsOut = h('p', { class: 'small muted' });
      const drawIngs = () => {
        const t = ingredients.reduce((a, i) => { const k = i.grams / 100; return { g: a.g + i.grams, kcal: a.kcal + i.kcal * k, p: a.p + i.protein * k, c: a.c + i.carbs * k, f: a.f + i.fat * k }; }, { g: 0, kcal: 0, p: 0, c: 0, f: 0 });
        const sv = parseFloat(servIn.value) || 1;
        totalsOut.textContent = ingredients.length ? `Whole recipe ${fmt0(t.kcal)} kcal, ${fmt0(t.g)} g. Per serving ${fmt0(t.kcal / sv)} kcal, P ${fmt0(t.p / sv)} C ${fmt0(t.c / sv)} F ${fmt0(t.f / sv)}.` : 'Add ingredients below.';
        ingList.replaceChildren(...ingredients.map((i, idx) => h('div', { class: 'list-row' },
          h('div', { class: 'main' }, h('span', { class: 'title' }, i.name), h('span', { class: 'small muted' }, `${fmt0(i.grams)} g, ${fmt0(i.kcal * i.grams / 100)} kcal`)),
          h('button', { class: 'icon-btn', 'aria-label': `Remove ${i.name}`, onclick: () => { ingredients.splice(idx, 1); drawIngs(); } }, icon('trash', 20)))));
        return t;
      };
      servIn.addEventListener('input', drawIngs);

      const qIn = h('input', { type: 'search', placeholder: 'Search ingredients', 'aria-label': 'Search ingredients' });
      const results = h('div', { class: 'list' });
      const search = debounce(async () => {
        const q = qIn.value.trim();
        if (q.length < 2) { results.replaceChildren(); return; }
        results.replaceChildren(h('p', { class: 'small muted' }, 'Searching…'));
        try {
          const r = await get('foods/search', { q });
          results.replaceChildren(...[...r.mine.filter(f => f.source !== 'recipe'), ...r.results].slice(0, 12).map(f => {
            const box = h('div', { class: 'list-row', style: { flexDirection: 'column', alignItems: 'stretch' } });
            const btn = h('button', { class: 'main', style: { background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }, onclick: async () => {
              if (f.source === 'usda' && !f.id && !f._detailed) { try { Object.assign(f, (await get('foods/detail', { id: f.source_id })).food, { _detailed: true }); } catch {} }
              box.replaceChildren(btn, amountEditor(f, { submitLabel: 'Add', onSubmit: async (amt) => {
                let id = f.id;
                if (!id) { id = (await post('foods/save', { food: { ...f, source: f.source } })).food?.id; }
                ingredients.push({ food_id: id, name: f.name, grams: amt.grams, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat, fiber: f.fiber });
                qIn.value = ''; results.replaceChildren(); drawIngs();
              } }));
            } }, h('span', { class: 'title' }, f.name), h('span', { class: 'small muted' }, [f.kind, f.brand, `${fmt0(f.kcal)} kcal per 100 g`].filter(Boolean).join(', ')));
            box.append(btn);
            return box;
          }));
        } catch (e) { results.replaceChildren(h('p', { class: 'banner' }, e.message)); }
      }, 350);
      qIn.addEventListener('input', search);

      const save = h('button', { class: 'btn primary block', onclick: async () => {
        const name = nameIn.value.trim();
        if (!name) { toast('Give the recipe a name', 'error'); return; }
        if (!ingredients.length) { toast('Add at least one ingredient', 'error'); return; }
        const t = drawIngs();
        const sv = parseFloat(servIn.value) || 1;
        const k = 100 / t.g;
        const food = {
          id: recipe?.id, source: 'recipe', source_id: recipe?.source_id, name,
          kcal: t.kcal * k, protein: t.p * k, carbs: t.c * k, fat: t.f * k,
          portions: [{ label: '1 serving', grams: +(t.g / sv).toFixed(1) }, { label: 'whole recipe', grams: t.g }],
          recipe: { servings: sv, ingredients },
        };
        try { await post('foods/save', { food }); toast('Recipe saved'); sheet.close(); onSaved?.(); }
        catch (e) { toast(e.message, 'error'); }
      } }, 'Save recipe');

      sheet.body.append(
        h('div', { class: 'grid-2' }, h('label', { class: 'field', for: 'rc-name' }, 'Recipe name', nameIn), h('label', { class: 'field', for: 'rc-serv' }, 'Servings', servIn)),
        totalsOut, ingList,
        h('label', { class: 'search' }, icon('search'), qIn),
        results, save,
        recipe?.id ? h('button', { class: 'btn block danger', onclick: async () => {
          if (!(await confirmSheet('Delete recipe?', 'Past log entries keep their numbers.'))) return;
          await post('foods/delete', { id: recipe.id }); sheet.close(); onSaved?.();
        } }, 'Delete recipe') : null);
      drawIngs();
    },
  });
}

/* ======================= barcode scanner ======================= */

// Chrome on Android and desktop has a built-in barcode reader (BarcodeDetector). Safari doesn't,
// so on iPhone the app loads a small decoder (ZXing, self-hosted) and reads frames itself.
let zxingLoad = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoad ||= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'assets/vendor/zxing.min.js';
    sc.onload = () => (window.ZXing ? resolve(window.ZXing) : reject(new Error('Scanner failed to load')));
    sc.onerror = () => { zxingLoad = null; reject(new Error("Couldn't load the scanner. Check your connection.")); };
    document.head.append(sc);
  });
  return zxingLoad;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats?.() || [];
      if (!formats.length || formats.includes('ean_13')) {
        const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        const fn = async (video) => (await det.detect(video))[0]?.rawValue || null;
        fn.native = true;
        return fn;
      }
    } catch { /* fall back to ZXing */ }
  }
  const Z = await loadZXing();
  const hints = new Map();
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Read the middle band of the frame, where the guide box is. Smaller and faster than the full frame.
    const cw = Math.round(vw * 0.86), ch = Math.round(vh * 0.42);
    const scale = Math.min(1, 960 / cw);
    canvas.width = Math.round(cw * scale); canvas.height = Math.round(ch * scale);
    ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
    try {
      const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      return reader.decode(bmp).getText();
    } catch { return null; } finally { reader.reset(); }
  };
}

/** Full-screen camera scanner. Calls onFood(food) when a barcode matches. */
export function openScanner({ onFood }) {
  let stream = null;
  let stopped = false;
  const stop = () => { stopped = true; stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const lookup = async (code) => {
    status.textContent = `Looking up ${code}…`;
    try {
      const r = await get('foods/barcode', { code });
      close(); onFood(r.food);
    } catch (e) {
      close();
      if (e.status === 404) { toast('No match for that barcode. Enter it as your own food.'); openFoodEditor({ barcode: code, onSaved: (f) => f && onFood(f) }); }
      else toast(e.message, 'error');
    }
  };
  const status = h('p', { class: 'scan-status', role: 'status' }, 'Starting the camera…');
  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Camera preview' });
  video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
  const torchBtn = h('button', { class: 'scan-round', type: 'button', hidden: true, 'aria-label': 'Turn on flashlight', 'aria-pressed': 'false' }, icon('torch'));
  const manual = h('form', { class: 'scan-manual', onsubmit: (e) => { e.preventDefault(); const c = e.target.querySelector('input').value.replace(/\D/g, ''); if (c.length >= 6) { stop(); lookup(c); } else toast('Enter the full number under the barcode', 'error'); } },
    h('label', { class: 'sr', for: 'scan-code' }, 'Barcode number'),
    h('input', { id: 'scan-code', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Or type the number' }),
    h('button', { class: 'btn sm', type: 'submit' }, 'Look up'));
  const overlay = h('div', { class: 'scanner-full', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scan a barcode' },
    h('div', { class: 'scan-top' },
      h('button', { class: 'scan-round', type: 'button', 'aria-label': 'Close scanner', onclick: () => close() }, icon('close')),
      h('span', { class: 'scan-title' }, 'Scan barcode'),
      torchBtn),
    h('div', { class: 'scan-stage' }, video, h('div', { class: 'scan-frame', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('b'))),
    status, manual);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    stop(); overlay.remove(); document.removeEventListener('keydown', onKey);
    document.body.style.overflow = document.querySelector('.scrim') ? 'hidden' : '';
  }
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { status.textContent = "This browser can't use the camera here. Type the number under the barcode."; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (stopped) { stop(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      if (track?.getCapabilities?.().torch) {
        torchBtn.hidden = false;
        torchBtn.onclick = async () => {
          const on = torchBtn.getAttribute('aria-pressed') !== 'true';
          try { await track.applyConstraints({ advanced: [{ torch: on }] }); torchBtn.setAttribute('aria-pressed', String(on)); } catch {}
        };
      }
    } catch {
      status.textContent = 'Camera access was blocked. Allow the camera for this site in your browser settings, or type the number.';
      overlay.querySelector('.scan-stage').classList.add('off');
      return;
    }
    let detect;
    try { detect = await makeDetector(); } catch (e) { status.textContent = `${e.message} You can type the number instead.`; return; }
    status.textContent = 'Hold the barcode inside the frame.';
    let last = '', hits = 0;
    const tick = async () => {
      if (stopped) return;
      let code = null;
      try { code = await detect(video); } catch { /* frame not ready */ }
      if (code && /^\d{6,14}$/.test(code)) {
        // Two matching reads in a row avoids acting on a misread.
        hits = code === last ? hits + 1 : 1; last = code;
        if (hits >= 2 || detect.native) { navigator.vibrate?.(60); stop(); lookup(code); return; }
      }
      setTimeout(tick, 120);
    };
    tick();
  })();
}

/* ======================= edit a logged entry ======================= */

function openEntry(e, meals, refresh) {
  openSheet({
    title: e.name,
    body: async (sheet) => {
      const mealSel = h('select', { class: 'input', id: 'en-meal' }, meals.map(m => h('option', { selected: m === e.meal }, m)));
      const del = h('button', { class: 'btn block danger', onclick: async () => {
        await post('diary/delete', { id: e.id }); markStale(); sheet.close(); toast('Removed'); refresh();
      } }, 'Remove from log');

      if (e.food_id && e.grams) {
        // Rebuild the per-100 g food from the entry so the editor works offline-free.
        const k = 100 / e.grams;
        let food = { name: e.name, kcal: e.kcal * k, protein: e.protein * k, carbs: e.carbs * k, fat: e.fat * k, portions: [] };
        try { const mine = await get('foods/mine'); const f = mine.foods.find(x => x.id === e.food_id); if (f) food.portions = f.portions; } catch {}
        sheet.body.append(
          amountEditor(food, { initialGrams: e.grams, submitLabel: 'Save', onSubmit: async (amt) => {
            await post('diary/update', { id: e.id, meal: mealSel.value, ...amt }); markStale(); sheet.close(); toast('Updated'); refresh();
          } }),
          h('label', { class: 'field', for: 'en-meal' }, 'Meal', mealSel),
          h('p', { class: 'note small' }, 'Change the meal, then press Save.'),
          del);
      } else {
        const f = h('form', { class: 'stack', onsubmit: async (ev) => {
          ev.preventDefault();
          await post('diary/update', { id: e.id, meal: mealSel.value, name: f.querySelector('#en-name').value, kcal: val(f, 'en-kcal'), protein: val(f, 'en-p'), carbs: val(f, 'en-c'), fat: val(f, 'en-f') });
          markStale(); sheet.close(); toast('Updated'); refresh();
        } },
          h('label', { class: 'field', for: 'en-name' }, 'Name', h('input', { id: 'en-name', value: e.name })),
          h('div', { class: 'grid-2' }, numField('Calories', 'en-kcal', String(e.kcal)), numField('Protein (g)', 'en-p', String(e.protein))),
          h('div', { class: 'grid-2' }, numField('Carbs (g)', 'en-c', String(e.carbs)), numField('Fat (g)', 'en-f', String(e.fat))),
          h('label', { class: 'field', for: 'en-meal' }, 'Meal', mealSel),
          h('button', { class: 'btn primary block', type: 'submit' }, 'Save'));
        sheet.body.append(f, del);
      }
    },
  });
}

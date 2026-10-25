// Meal plans: build a day of food and check the totals against your targets without logging it.
import { h, icon, fmt0, fmt1, todayISO, openSheet, toast, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, markStale } from '../store.js';
import { pageHead } from '../components.js';
import { openAddFood, foodSwitch, amountEditor } from './food.js';
import { gripHandle, makeSortable } from '../sortable.js';

const LAST_KEY = 'ff_last_plan';
const lastPlan = () => { try { return +localStorage.getItem(LAST_KEY) || null; } catch { return null; } };
const rememberPlan = (id) => { try { localStorage.setItem(LAST_KEY, String(id)); } catch {} };
const sum = (items) => items.reduce((a, e) => ({ kcal: a.kcal + (e.kcal || 0), protein: a.protein + (e.protein || 0), carbs: a.carbs + (e.carbs || 0), fat: a.fat + (e.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

export async function render(root, params) {
  await loadSummary();
  const { plans } = await get('plans');
  const { targets, settings } = state;
  const wanted = +params[0] || lastPlan();
  const plan = plans.find(p => p.id === wanted) || plans[0] || null;
  if (plan) rememberPlan(plan.id);
  const refresh = () => render(root, [plan?.id]);

  const head = pageHead('Plans never touch your food log', 'Meal plans', [
    h('button', { class: 'btn sm', onclick: () => newPlan((p) => { location.hash = `#/plans/${p.id}`; }) }, icon('plus', 18), 'New plan')]);

  if (!plan) {
    root.replaceChildren(head, h('div', { class: 'stack', style: { maxWidth: '760px' } }, foodSwitch('plan'),
      h('section', { class: 'card', 'aria-label': 'No plans yet' },
        h('h2', null, 'Plan a day of food'),
        h('p', { class: 'note' }, 'Build a day from your foods and recipes, see the totals against your targets, and tweak amounts until it fits. Nothing is logged until you choose to log it.'),
        h('button', { class: 'btn primary', style: { alignSelf: 'flex-start' }, onclick: () => newPlan((p) => { location.hash = `#/plans/${p.id}`; }) }, 'Create a plan'))));
    return;
  }

  const items = plan.items;
  const tot = sum(items);
  const diff = Math.round(tot.kcal - targets.kcal);

  const chips = h('div', { class: 'plan-chips', role: 'list' },
    plans.map(p => h('a', { class: 'pill', role: 'listitem', href: `#/plans/${p.id}`, 'aria-current': p.id === plan.id ? 'page' : null }, p.name)));

  const macroRow = (name, cls, planned, target) => {
    const d = Math.round(planned - target);
    return h('div', { class: 'plan-macro' },
      h('div', { class: 'plan-macro-head' },
        h('span', { class: 'name' }, h('span', { class: 'swatch ' + cls, 'aria-hidden': 'true' }), name),
        h('span', null, h('strong', null, fmt0(planned)), h('span', { class: 'muted' }, ` / ${fmt0(target)} g, ${d === 0 ? 'on target' : d > 0 ? `${d} over` : `${-d} under`}`))),
      h('div', { class: 'meter', role: 'img', 'aria-label': `${name} ${fmt0(planned)} of ${fmt0(target)} grams planned` },
        h('div', { class: cls, style: { width: `${Math.min(100, (planned / (target || 1)) * 100)}%` } })));
  };

  const totals = h('section', { class: 'card pad-lg', 'aria-label': 'Plan totals against your targets' },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('span', { class: 'muted', style: { fontSize: '14px', fontWeight: 500 } }, 'Planned calories'),
        h('span', { class: 'hero-num', style: { fontSize: '64px' } }, fmt0(tot.kcal))),
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingBottom: '6px' } },
        h('span', { class: 'num', style: { fontSize: '22px', fontWeight: 600, color: Math.abs(diff) > targets.kcal * 0.05 ? (diff > 0 ? 'var(--red)' : 'var(--ink)') : 'var(--green)' } },
          Math.abs(diff) < 1 ? 'On target' : `${fmt0(Math.abs(diff))} ${diff > 0 ? 'over' : 'under'}`),
        h('span', { class: 'small muted' }, `today's target ${fmt0(targets.kcal)}`))),
    macroRow('Protein', 'c-protein', tot.protein, targets.protein),
    macroRow('Carbs', 'c-carbs', tot.carbs, targets.carbs),
    macroRow('Fat', 'c-fat', tot.fat, targets.fat));

  const save = async (next) => {
    try { await post('plans/save', { id: plan.id, items: next }); refresh(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const target = {
    name: plan.name,
    add: (food, amt, meal) => post('plans/add', { plan_id: plan.id, meal, food: food.id ? food.id : food, ...amt }),
    addQuick: (quick, meal) => post('plans/add', { plan_id: plan.id, meal, quick }),
  };

  const mealNames = [...settings.meals, ...new Set(items.map(i => i.meal).filter(m => !settings.meals.includes(m)))];
  const mealCards = mealNames.map(meal => {
    const idx = items.map((it, i) => (it.meal === meal ? i : -1)).filter(i => i >= 0);
    const m = sum(idx.map(i => items[i]));
    return h('section', { class: 'card', 'aria-label': meal, style: { gap: '4px' } },
      h('div', { class: 'card-head', style: { alignItems: 'center' } },
        h('h2', { style: { font: '600 17px var(--body)' } }, meal),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
          h('span', { class: 'small muted' }, idx.length ? `${fmt0(m.kcal)} kcal` : ''),
          h('button', { class: 'icon-btn', 'aria-label': `Add food to ${meal} in this plan`, style: { color: 'var(--primary)' },
            onclick: () => openAddFood({ date: todayISO(), meal, target, onDone: refresh }) }, icon('plus')))),
      idx.length ? h('div', { class: 'list' }, idx.map(i => {
        const e = items[i];
        return h('button', { class: 'list-row', onclick: () => editItem(items, i, mealNames, save) },
          h('div', { class: 'main' },
            h('span', { style: { fontSize: '15px' } }, e.name),
            h('span', { class: 'tiny muted' }, [e.brand, e.portion_label || (e.grams ? `${fmt0(e.grams)} g` : null), `P ${fmt0(e.protein)}  C ${fmt0(e.carbs)}  F ${fmt0(e.fat)}`].filter(Boolean).join(', '))),
          h('span', { class: 'muted', style: { fontVariantNumeric: 'tabular-nums' } }, fmt0(e.kcal)));
      })) : null);
  });

  root.replaceChildren(
    head,
    h('div', { class: 'stack' },
      foodSwitch('plan'),
      chips,
      h('div', { class: 'row' },
        h('div', { class: 'grow-2 stack' }, totals,
          h('div', { class: 'grid-2' },
            h('button', { class: 'btn', onclick: () => planMenu(plan, refresh, plans) }, 'Plan options'),
            h('button', { class: 'btn primary', disabled: !items.length, onclick: () => logPlan(plan, mealNames) }, 'Log to a day'))),
        h('div', { class: 'grow-3 stack' }, mealCards))));
}

function newPlan(onCreated) {
  const s = openSheet({
    title: 'New plan',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const name = e.target.querySelector('#pl-name').value.trim();
      if (!name) { toast('Name the plan', 'error'); return; }
      try { const r = await post('plans/save', { name }); s.close(); onCreated(r.plan); }
      catch (err) { toast(err.message, 'error'); }
    } },
      h('label', { class: 'field', for: 'pl-name' }, 'Name', h('input', { id: 'pl-name', placeholder: 'Training day', maxlength: 80, autofocus: true })),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Create plan')),
  });
}

function reorderPlans(plans, refresh) {
  openSheet({
    title: 'Reorder plans',
    onClose: refresh,
    body: (sheet) => {
      let order = [...plans];
      const list = h('div', { class: 'list' });
      const draw = () => list.replaceChildren(...order.map(p => h('div', { class: 'list-row sort-row', 'data-key': String(p.id), 'data-label': p.name },
        gripHandle(p.name), h('div', { class: 'main' }, h('span', { class: 'title' }, p.name), h('span', { class: 'small muted' }, `${p.items.length} item${p.items.length === 1 ? '' : 's'}`)))));
      makeSortable(list, { onChange: async (keys) => {
        order = keys.map(k => order.find(p => String(p.id) === k));
        try { await post('plans/order', { ids: keys.map(Number) }); } catch (e) { toast(e.message, 'error'); }
      } });
      draw();
      sheet.body.append(h('p', { class: 'note small' }, 'Drag the handle to change the order of the plan chips.'), list, h('button', { class: 'btn primary block', onclick: () => sheet.close() }, 'Done'));
    },
  });
}

function planMenu(plan, refresh, plans = []) {
  const s = openSheet({
    title: plan.name,
    body: h('div', { class: 'stack' },
      h('form', { class: 'row', style: { alignItems: 'flex-end' }, onsubmit: async (e) => {
        e.preventDefault();
        const name = e.target.querySelector('#pl-rename').value.trim();
        if (!name) return;
        await post('plans/save', { id: plan.id, name }); s.close(); toast('Renamed'); refresh();
      } },
        h('label', { class: 'field', for: 'pl-rename', style: { flex: 1 } }, 'Name', h('input', { id: 'pl-rename', value: plan.name, maxlength: 80 })),
        h('button', { class: 'btn', type: 'submit', style: { height: '46px' } }, 'Rename')),
      h('button', { class: 'btn block', onclick: async () => {
        const r = await post('plans/duplicate', { id: plan.id }); s.close(); toast('Plan duplicated'); location.hash = `#/plans/${r.plan.id}`;
      } }, 'Duplicate plan'),
      plans.length > 1 ? h('button', { class: 'btn block', onclick: () => { s.close(); reorderPlans(plans, refresh); } }, 'Reorder plans') : null,
      plan.items.length ? h('button', { class: 'btn block', onclick: async () => {
        if (!(await confirmSheet('Clear this plan?', `Remove all ${plan.items.length} items from ${plan.name}?`, 'Clear'))) return;
        await post('plans/save', { id: plan.id, items: [] }); s.close(); refresh();
      } }, 'Clear all items') : null,
      h('button', { class: 'btn block danger', onclick: async () => {
        if (!(await confirmSheet('Delete plan?', `Delete ${plan.name}? Your food log isn't affected.`))) return;
        await post('plans/delete', { id: plan.id }); s.close(); toast('Plan deleted');
        try { localStorage.removeItem(LAST_KEY); } catch {}
        location.hash = '#/plans';
        if (location.hash === '#/plans') window.dispatchEvent(new Event('hashchange'));
      } }, 'Delete plan')),
  });
}

function logPlan(plan, meals) {
  const present = meals.filter(m => plan.items.some(i => i.meal === m));
  const dateIn = h('input', { class: 'input', type: 'date', id: 'pl-date', value: todayISO() });
  const mealSel = h('select', { class: 'input', id: 'pl-meal' }, h('option', { value: '' }, `Whole plan (${plan.items.length} items)`), present.map(m => h('option', { value: m }, m)));
  const s = openSheet({
    title: 'Log to a day',
    body: h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const r = await post('plans/log', { id: plan.id, date: dateIn.value, meal: mealSel.value || null });
        markStale(); s.close();
        toast(`Logged ${r.logged} item${r.logged === 1 ? '' : 's'}`);
        location.hash = dateIn.value === todayISO() ? '#/food/diary' : `#/food/${dateIn.value}`;
      } catch (err) { toast(err.message, 'error'); }
    } },
      h('p', { class: 'note' }, 'Copies the plan into your food log. The plan stays as it is, so you can use it again.'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field', for: 'pl-date' }, 'Day', dateIn), h('label', { class: 'field', for: 'pl-meal' }, 'What to log', mealSel)),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Log it')),
  });
}

function editItem(items, i, meals, save) {
  const e = items[i];
  openSheet({
    title: e.name,
    body: async (sheet) => {
      const mealSel = h('select', { class: 'input', id: 'pi-meal' }, meals.map(m => h('option', { selected: m === e.meal }, m)));
      const remove = h('button', { class: 'btn block danger', onclick: () => { sheet.close(); save(items.filter((_, k) => k !== i)); } }, 'Remove from plan');
      const commit = (patch) => { sheet.close(); save(items.map((x, k) => (k === i ? { ...x, ...patch, meal: mealSel.value } : x))); };
      if (e.grams) {
        const k = 100 / e.grams;
        const food = { name: e.name, kcal: e.kcal * k, protein: e.protein * k, carbs: e.carbs * k, fat: e.fat * k, fiber: e.fiber == null ? null : e.fiber * k, portions: [] };
        if (e.food_id) { try { const f = (await get('foods/mine')).foods.find(x => x.id === e.food_id); if (f) food.portions = f.portions; } catch {} }
        sheet.body.append(
          amountEditor(food, { initialGrams: e.grams, submitLabel: 'Save', onSubmit: (amt) => {
            const r = amt.grams / e.grams;
            commit({ grams: amt.grams, quantity: amt.quantity, portion_label: amt.portion_label,
              kcal: +(e.kcal * r).toFixed(1), protein: +(e.protein * r).toFixed(1), carbs: +(e.carbs * r).toFixed(1), fat: +(e.fat * r).toFixed(1), fiber: e.fiber == null ? null : +(e.fiber * r).toFixed(1) });
          } }),
          h('label', { class: 'field', for: 'pi-meal' }, 'Meal', mealSel),
          h('p', { class: 'note small' }, 'Change the amount or meal, then press Save.'),
          remove);
      } else {
        const num = (id, label, v) => h('label', { class: 'field', for: id }, label, h('input', { id, inputmode: 'decimal', value: String(v ?? '') }));
        const f = h('form', { class: 'stack', onsubmit: (ev) => {
          ev.preventDefault();
          const n = (id) => Math.max(0, parseFloat(f.querySelector('#' + id).value.replace(',', '.')) || 0);
          commit({ name: f.querySelector('#pi-name').value.trim() || e.name, kcal: n('pi-k'), protein: n('pi-p'), carbs: n('pi-c'), fat: n('pi-f') });
        } },
          h('label', { class: 'field', for: 'pi-name' }, 'Name', h('input', { id: 'pi-name', value: e.name })),
          h('div', { class: 'grid-2' }, num('pi-k', 'Calories', e.kcal), num('pi-p', 'Protein (g)', e.protein)),
          h('div', { class: 'grid-2' }, num('pi-c', 'Carbs (g)', e.carbs), num('pi-f', 'Fat (g)', e.fat)),
          h('label', { class: 'field', for: 'pi-meal' }, 'Meal', mealSel),
          h('button', { class: 'btn primary block', type: 'submit' }, 'Save'));
        sheet.body.append(f, remove);
      }
      sheet.body.append(h('p', { class: 'tiny muted' }, `${fmt1(e.protein)} g protein, ${fmt1(e.carbs)} g carbs, ${fmt1(e.fat)} g fat`));
    },
  });
}

import { h, fmt1, toast, timeAgo, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, markStale, applyTheme, imperial } from '../store.js';
import { pageHead } from '../components.js';
import { installPrompt } from '../pwa.js';
import { gripHandle, makeSortable } from '../sortable.js';
import { icon } from '../ui.js';

const LB = 2.20462;

export async function render(root, params = []) {
  if (params[0] === 'sync') return (await import('./sync.js')).render(root);
  await loadSummary(true);
  const s = structuredClone(state.settings);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  if (q.get('whoop') === 'connected') { toast('WHOOP connected'); history.replaceState(null, '', '#/settings'); }
  if (q.get('whoop_error')) { toast(q.get('whoop_error'), 'error'); history.replaceState(null, '', '#/settings'); }
  const st = state.summary.whoop;

  const sel = (id, value, options) => h('select', { id, class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  const inp = (id, value, attrs = {}) => h('input', { id, value: value ?? '', ...attrs });
  const field = (label, control, hint) => h('label', { class: 'field', for: control.id }, label, control, hint ? h('span', { class: 'tiny muted', style: { fontWeight: 400 } }, hint) : null);

  const trendKg = state.model.trendKg || 80;
  const rateHint = (pct) => {
    const kg = (pct / 100) * trendKg;
    return `About ${fmt1(imperial() ? kg * LB : kg)} ${imperial() ? 'lb' : 'kg'} per week at your current weight`;
  };
  const rates = [0.25, 0.5, 0.75, 1, 1.25];
  if (!rates.includes(+s.goal.rate_pct)) rates.push(+s.goal.rate_pct);
  const rateSel = sel('st-rate', s.goal.rate_pct, rates.sort((a, b) => a - b).map(r => [r, `${r}% of weight / week`]));
  const rateHintEl = h('span', { class: 'tiny muted' }, rateHint(s.goal.rate_pct));
  rateSel.addEventListener('change', () => { rateHintEl.textContent = rateHint(+rateSel.value); });
  const goalSel = sel('st-goal', s.goal.type, [['lose', 'Lose fat'], ['maintain', 'Maintain'], ['gain', 'Build muscle (gain)']]);
  const progSel = sel('st-prog', s.program, [['coached', 'Coached: weekly check-ins set targets'], ['manual', 'Manual: I set my own targets']]);
  const manualBox = h('div', { class: 'form-grid' },
    field('Calories', inp('st-mk', s.manual_targets.kcal, { inputmode: 'numeric' })),
    field('Protein (g)', inp('st-mp', s.manual_targets.protein, { inputmode: 'numeric' })),
    field('Carbs (g)', inp('st-mc', s.manual_targets.carbs, { inputmode: 'numeric' })),
    field('Fat (g)', inp('st-mf', s.manual_targets.fat, { inputmode: 'numeric' })));
  const syncManual = () => { manualBox.hidden = progSel.value !== 'manual'; };
  progSel.addEventListener('change', syncManual); syncManual();

  const protDisplay = imperial() ? +(s.macros.protein_g_per_kg / LB).toFixed(2) : s.macros.protein_g_per_kg;
  const totalIn = s.height_cm / 2.54;
  const heightFields = imperial()
    ? h('div', { class: 'grid-2' }, field('Height (ft)', inp('st-hft', Math.floor(totalIn / 12), { inputmode: 'numeric' })), field('Height (in)', inp('st-hin', Math.round(totalIn % 12), { inputmode: 'numeric' })))
    : field('Height (cm)', inp('st-hcm', Math.round(s.height_cm), { inputmode: 'numeric' }));

  // Meal names: a draggable list instead of comma-separated text.
  let meals = [...s.meals];
  const mealList = h('div', { class: 'list meal-list', 'aria-label': 'Meals' });
  const drawMeals = () => mealList.replaceChildren(...meals.map((m, i) => h('div', { class: 'list-row sort-row', 'data-key': String(i), 'data-label': m || 'meal' },
    gripHandle(m || 'meal'),
    h('input', { class: 'input', value: m, maxlength: 32, 'aria-label': `Meal ${i + 1} name`, oninput: (e) => { meals[i] = e.target.value; } }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${m || 'meal'}`, disabled: meals.length <= 1, onclick: () => { meals.splice(i, 1); drawMeals(); } }, icon('close')))));
  makeSortable(mealList, { onChange: (keys) => { meals = keys.map(k => meals[+k]); drawMeals(); } });
  drawMeals();

  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = (id) => form.querySelector('#' + id)?.value;
    const n = (id) => parseFloat(v(id));
    const unitsNow = v('st-units');
    const patch = {
      goal: { type: v('st-goal'), rate_pct: n('st-rate') },
      program: v('st-prog'),
      manual_targets: { kcal: n('st-mk'), protein: n('st-mp'), carbs: n('st-mc'), fat: n('st-mf') },
      macros: { protein_g_per_kg: imperial() ? n('st-prot') * LB : n('st-prot'), diet: v('st-diet') },
      checkin_weekday: +v('st-ckd'),
      sex: v('st-sex'), birth_year: n('st-by'), activity: v('st-act'),
      height_cm: imperial() ? ((n('st-hft') || 0) * 12 + (n('st-hin') || 0)) * 2.54 : n('st-hcm'),
      initial_expenditure: v('st-init') ? n('st-init') : null,
      units: unitsNow, theme: v('st-theme'),
      meals: [...mealList.querySelectorAll('input')].map(x => x.value.trim()).filter(Boolean),
      rest_seconds: n('st-rest'),
      lift_days_goal: n('st-lift'),
    };
    try {
      await post('settings', patch);
      markStale(); await loadSummary(true); applyTheme();
      toast('Settings saved');
      render(root);
    } catch (err) { toast(err.message, 'error'); }
  } },
    h('section', { class: 'card', 'aria-label': 'Goal and targets' },
      h('h2', null, 'Goal and targets'),
      h('div', { class: 'form-grid' }, field('Goal', goalSel), h('label', { class: 'field', for: 'st-rate' }, 'Rate', rateSel, rateHintEl)),
      field('How targets are set', progSel),
      s.phases?.items?.length
        ? h('p', { class: 'banner info' }, state.phase ? 'Your diet phases set the goal and rate for check-ins while the plan runs. ' : 'Your diet phases take over from this goal while the plan runs. ', h('a', { href: '#/phases' }, 'Edit diet phases'))
        : h('a', { class: 'small', href: '#/phases', style: { fontWeight: 600 } }, 'Plan diet phases: cuts, breaks and reverse diets'),
      manualBox,
      h('div', { class: 'form-grid' },
        field(`Protein (g per ${imperial() ? 'lb' : 'kg'} of body weight)`, inp('st-prot', protDisplay, { inputmode: 'decimal' }), imperial() ? '0.7 to 1.0 is typical when training' : '1.6 to 2.2 is typical when training'),
        field('Diet style', sel('st-diet', s.macros.diet, [['balanced', 'Balanced'], ['low_fat', 'Lower fat'], ['low_carb', 'Lower carb'], ['keto', 'Keto (30 g carbs)']])),
        field('Check-in day', sel('st-ckd', s.checkin_weekday, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [i, d]))))),
    h('section', { class: 'card', 'aria-label': 'About you' },
      h('h2', null, 'About you'),
      h('p', { class: 'note small' }, 'Used only for the starting expenditure estimate. After a couple of weeks your own data takes over.'),
      h('div', { class: 'form-grid' },
        field('Sex', sel('st-sex', s.sex, [['male', 'Male'], ['female', 'Female']])),
        field('Birth year', inp('st-by', s.birth_year, { inputmode: 'numeric' })),
        field('Activity outside workouts', sel('st-act', s.activity, [['sedentary', 'Mostly sitting'], ['light', 'Lightly active'], ['moderate', 'Moderately active'], ['active', 'Active job'], ['very_active', 'Very active']]))),
      heightFields,
      field('Starting expenditure (optional)', inp('st-init', s.initial_expenditure ?? '', { inputmode: 'numeric', placeholder: 'e.g. from MacroFactor' }), 'If you know your expenditure from another app, enter it to skip the warm-up period.')),
    h('section', { class: 'card', 'aria-label': 'App' },
      h('h2', null, 'App'),
      h('div', { class: 'form-grid' },
        field('Units', sel('st-units', s.units, [['imperial', 'Pounds (lb)'], ['metric', 'Kilograms (kg)']])),
        field('Appearance', sel('st-theme', s.theme, [['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']])),
        field('Rest timer (seconds)', inp('st-rest', s.rest_seconds, { inputmode: 'numeric' })),
        field('Lifting sessions a week', inp('st-lift', s.lift_days_goal, { inputmode: 'numeric' }), 'Goal shown on the Train overview')),
      h('div', { class: 'field' }, h('span', null, 'Meals'), h('span', { class: 'tiny muted', style: { fontWeight: 400 } }, 'Drag to reorder, up to 8.'), mealList,
        h('button', { class: 'btn sm ghost', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => { if (meals.length < 8) { meals.push(''); drawMeals(); mealList.lastChild?.querySelector('input')?.focus(); } } }, icon('plus', 16), 'Add a meal'))),
    h('button', { class: 'btn primary', type: 'submit', style: { alignSelf: 'flex-start' } }, 'Save settings'));

  const whoopSec = h('section', { class: 'card', 'aria-label': 'WHOOP' },
    h('h2', null, 'WHOOP'),
    !st.configured
      ? h('p', { class: 'note' }, `Add your WHOOP client ID and secret to api/config.php. In the WHOOP developer dashboard, set the redirect URL to ${st.redirect_uri}`)
      : st.connected
        ? h('div', { class: 'stack' },
            h('p', { class: 'note' }, `Connected. Last synced ${timeAgo(st.last_sync_at)}.`),
            h('div', { class: 'row' },
              h('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { const r = await post('whoop/sync', {}); toast(`Synced ${r.days} days`); markStale(); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'Sync now'),
              h('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { const r = await post('whoop/sync', { days: 365 }); toast(`Synced ${r.days} days`); markStale(); } catch (err) { toast(err.message, 'error'); } e.target.disabled = false; } }, 'Re-sync last year'),
              h('button', { class: 'btn sm danger', onclick: async () => {
                if (!(await confirmSheet('Disconnect WHOOP?', 'This revokes access and deletes all WHOOP data stored in this app. Your food, weight and training logs stay.', 'Disconnect and delete'))) return;
                await post('whoop/disconnect', {}); markStale(); toast('WHOOP disconnected'); render(root);
              } }, 'Disconnect')))
        : h('div', { class: 'stack' },
            h('p', { class: 'note' }, 'Bring in recovery, HRV, resting heart rate, sleep and strain.'),
            h('a', { class: 'btn primary', href: 'api/?r=whoop/connect', style: { alignSelf: 'flex-start' } }, 'Connect WHOOP')));

  const pw = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    try {
      await post('auth/password', { current: pw.querySelector('#pw-cur').value, new: pw.querySelector('#pw-new').value });
      toast('Password changed. Other devices will need to sign in again.'); pw.reset();
    } catch (err) { toast(err.message, 'error'); }
  } },
    h('div', { class: 'form-grid' },
      field('Current password', inp('pw-cur', '', { type: 'password', autocomplete: 'current-password' })),
      field('New password', inp('pw-new', '', { type: 'password', autocomplete: 'new-password', minlength: 10 }))),
    h('button', { class: 'btn sm', type: 'submit', style: { alignSelf: 'flex-start' } }, 'Change password'));

  const install = installPrompt();
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  root.replaceChildren(
    pageHead(state.user ? `Signed in as ${state.user.name} (@${state.user.username})` : '', 'Settings'),
    h('div', { class: 'stack', style: { maxWidth: '820px' } },
      h('a', { class: 'linkcard', href: '#/settings/sync' },
        h('span', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
          h('span', { class: 'journal-ic', 'aria-hidden': 'true' }, icon('bell')),
          h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('span', { style: { fontWeight: 600 } }, 'Reminders and sync'),
            h('span', { class: 'small muted' }, 'Notifications, smart scale, backups'))),
        icon('right', 20)),
      state.user?.is_admin ? h('a', { class: 'linkcard', href: '#/users' },
        h('span', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
          h('span', { class: 'journal-ic', 'aria-hidden': 'true' }, icon('users')),
          h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('span', { style: { fontWeight: 600 } }, 'Users'),
            h('span', { class: 'small muted' }, 'Add people and manage accounts'))),
        icon('right', 20)) : null,
      form,
      whoopSec,
      !standalone ? h('section', { class: 'card', 'aria-label': 'Install' },
        h('h2', null, 'Install the app'),
        install
          ? h('button', { class: 'btn sm', style: { alignSelf: 'flex-start' }, onclick: async () => { install.prompt(); } }, 'Install on this device')
          : h('p', { class: 'note' }, isIOS ? 'In Safari, tap Share, then Add to Home Screen.' : 'Use your browser menu and choose Install app or Add to Home screen.')) : null,
      h('section', { class: 'card', 'aria-label': 'Account' },
        h('h2', null, 'Account and data'),
        pw,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: async () => {
            const data = await get('export');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `farrell-fitness-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a); a.click(); a.remove();
          } }, 'Download all my data'),
          h('button', { class: 'btn sm danger', onclick: async () => { await post('auth/logout', {}); location.hash = '#/login'; location.reload(); } }, 'Sign out')),
        h('a', { href: 'privacy.html', class: 'small' }, 'Privacy policy'))));
}

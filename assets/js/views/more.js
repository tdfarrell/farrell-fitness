// More: everything that isn't a bottom tab.
import { h, icon, fmt0, timeAgo, relDay, todayISO, toast } from '../ui.js';
import { get, post } from '../api.js';
import { state, loadSummary, fmtW, wUnit } from '../store.js';
import { pageHead } from '../components.js';

export async function render(root) {
  await loadSummary();
  const { model, checkin, summary, settings } = state;
  const [hb, pl, jr, hl] = await Promise.all([
    get('habits', { date: todayISO(), days: 7 }).catch(() => null),
    get('plans').catch(() => null),
    get('journal/list', { limit: 1 }).catch(() => null),
    get('health').catch(() => null),
  ]);
  const done = hb ? hb.habits.filter(x => x.done).length : null;
  const vo2 = hl?.measurements.filter(m => m.kind === 'vo2max').pop();
  const meds = hl?.items || [];
  const lastJ = jr?.entries?.[0];
  const oor = hl?.labs_latest?.out_of_range?.length;

  const row = (href, ic, label, sub, dark) => h('a', { class: 'more-row', href },
    h('span', { class: 'more-ic' + (dark ? ' dark' : ''), 'aria-hidden': 'true' }, icon(ic)),
    h('span', { class: 'main' }, h('span', { class: 'title' }, label), sub ? h('span', { class: 'small muted' }, sub) : null),
    icon('right', 18));
  const group = (label, rows) => h('section', { class: 'card more-group', 'aria-label': label }, rows);

  root.replaceChildren(
    pageHead('Health, tracking and settings', 'More'),
    h('div', { class: 'stack', style: { maxWidth: '640px' } },
      group('Health', [
        row('#/health', 'health', 'Health', [vo2 ? `VO2 max ${fmt0(vo2.value)}` : null, meds.length ? `${meds.filter(m => m.taken_at).length} of ${meds.length} meds taken` : 'Vitals, sleep, meds'].filter(Boolean).join(', '), true),
        row('#/health/labs', 'drop', 'Labs and blood sugar', oor ? `${oor} result${oor > 1 ? 's' : ''} outside range` : hl?.labs_latest?.date ? `Last panel ${relDay(hl.labs_latest.date)}` : 'Add lab results and readings', true),
        row('#/weight', 'weight', 'Weight', model.trendKg ? `Trend ${fmtW(model.trendKg)} ${wUnit()}` : 'Log your weight', true),
      ]),
      group('Daily', [
        row('#/habits', 'habits', 'Habits', done != null ? `${done} of ${hb.habits.length} done today` : 'Daily checklist'),
        row('#/journal', 'journal', 'Journal', lastJ ? `Last entry ${relDay(lastJ.date).toLowerCase()}` : 'Write your first entry'),
        row('#/plans', 'plans', 'Meal plans', pl ? `${pl.plans.length} saved plan${pl.plans.length === 1 ? '' : 's'}` : 'Plan a day of food'),
      ]),
      group('Progress and app', [
        row('#/progress', 'progress', 'Progress and check-ins', checkin.due ? 'Your check-in is ready' : settings.program === 'manual' ? 'Week review' : `Next check-in ${relDay(checkin.next).toLowerCase()}`),
        row('#/whoop', 'whoop', 'WHOOP', summary.whoop.connected ? `Synced ${timeAgo(summary.whoop.last_sync_at)}` : 'Not connected'),
        row('#/settings', 'settings', 'Settings', 'Goals, units, account, data export'),
      ]),
      h('button', { class: 'btn sm ghost danger', style: { alignSelf: 'flex-start' }, onclick: async () => {
        try { await post('auth/logout', {}); } catch (e) { toast(e.message, 'error'); return; }
        location.hash = '#/login'; location.reload();
      } }, 'Sign out')));
}

// Insights: patterns across food, sleep, recovery, training and the journal. Each one says how many
// days it rests on and how much to trust it. They describe your data; they don't prove a cause.
import { h, icon, fmt0, fmt1, todayISO } from '../ui.js';
import { get } from '../api.js';
import { state, loadSummary } from '../store.js';
import { pageHead, loading } from '../components.js';
import { scatter } from '../charts.js';
import { addDays } from '../tdee.js';
import { mean, correlation, compareGroups, strengthOf, STRENGTH_RANK, STRENGTH_LABEL } from '../stats.js';

let span = 90;

/** One row per day with everything the insights look at. Exported for tests. */
export function buildDays(summaryDays, extra, today) {
  return summaryDays.map(d => {
    const x = extra[d.date] || {};
    const w = d.whoop || {};
    const counted = d.date < today && d.status !== 'exclude' && (d.entries > 0 || d.status === 'fasted');
    return {
      date: d.date, weekday: new Date(d.date + 'T12:00:00Z').getUTCDay(),
      kcal: counted ? d.kcal : null, protein: counted && d.entries > 0 ? d.protein : null,
      sleep: w.sleep_hours ?? null, recovery: w.recovery ?? null, hrv: w.hrv ?? null, strain: w.strain ?? null, steps: w.step_count ?? null,
      lifted: !!x.lifts?.length, cardio: !!x.cardio?.length,
      mood: x.journal?.mood ?? null, energy: x.journal?.energy ?? null, stress: x.journal?.stress ?? null,
    };
  });
}

const hm = (h0) => (h0 % 1 ? `${Math.floor(h0)}½` : String(h0));

/** Every pattern we check. Each returns null when there isn't data to look at. Exported for tests. */
export function findInsights(days) {
  const next = (i) => days[i + 1] || null;
  const out = [];
  const add = (o) => { if (o) out.push({ ...o, strength: strengthOf(o.stat) }); };

  // 1. Sleep and how much you eat that day.
  {
    const pairs = days.filter(d => d.sleep != null && d.kcal != null).map(d => [d.sleep, d.kcal]);
    const short = pairs.filter(p => p[0] < 6.5).map(p => p[1]), good = pairs.filter(p => p[0] >= 7).map(p => p[1]);
    if (pairs.length >= 5) {
      const c = correlation(pairs);
      const g = short.length >= 4 && good.length >= 4 ? compareGroups(short, good) : null;
      const diff = g ? g.diff : null;
      add({ id: 'sleep_kcal', area: 'Sleep and food',
        title: g && Math.abs(diff) < 40 ? 'You eat about the same after short nights as after 7 or more hours of sleep.'
          : g ? `After nights under 6½ hours of sleep, you eat about ${fmt0(Math.abs(diff))} kcal ${diff >= 0 ? 'more' : 'less'} that day than after 7 or more.`
          : c.slope != null ? `Each extra hour of sleep goes with about ${fmt0(Math.abs(c.slope))} kcal ${c.slope <= 0 ? 'less' : 'more'} eaten that day.` : 'Sleep and calories',
        detail: `${pairs.length} days with both sleep (WHOOP) and a full food log`,
        stat: { r: c.r, p: c.p, n: pairs.length }, effect: Math.abs(c.r || 0),
        chart: { type: 'scatter', points: pairs, fit: c, xFormat: (v) => `${v}h`, yFormat: fmt0, label: `Calories eaten against hours slept the night before, ${pairs.length} days` } });
    }
  }

  // 2. Lifting and next-day recovery.
  {
    const afterLift = [], afterRest = [];
    days.forEach((d, i) => { const n = next(i); if (!n || n.recovery == null) return; if (d.lifted) afterLift.push(n.recovery); else if (!d.cardio) afterRest.push(n.recovery); });
    if (afterLift.length >= 3 && afterRest.length >= 3) {
      const g = compareGroups(afterRest, afterLift);
      add({ id: 'lift_recovery', area: 'Training and recovery',
        title: Math.abs(g.diff) < 2 ? 'Recovery is about the same the day after lifting as after a rest day.'
          : `Recovery is ${fmt0(Math.abs(g.diff))} points ${g.diff >= 0 ? 'higher' : 'lower'} the day after a rest day than after a lifting day.`,
        detail: `${afterLift.length} days after lifting, ${afterRest.length} after rest, recovery from WHOOP`,
        stat: { d: g.d, p: g.p, n: g.na + g.nb }, effect: Math.abs(g.d || 0) / 2,
        chart: { type: 'bars', fmt: (v) => `${fmt0(v)}%`, groups: [{ label: 'After rest', value: g.ma }, { label: 'After lifting', value: g.mb }], label: `Average next-day recovery: after rest ${fmt0(g.ma)}%, after lifting ${fmt0(g.mb)}%` } });
    }
  }

  // 3. Day strain and next-day recovery.
  {
    const pairs = []; days.forEach((d, i) => { const n = next(i); if (d.strain != null && n?.recovery != null) pairs.push([d.strain, n.recovery]); });
    if (pairs.length >= 5) {
      const c = correlation(pairs);
      add({ id: 'strain_recovery', area: 'Training and recovery',
        title: Math.abs(c.slope || 0) < 0.5 ? 'Day strain has little effect on your next-day recovery.' : `Each extra point of day strain goes with ${fmt1(Math.abs(c.slope))} points ${c.slope < 0 ? 'lower' : 'higher'} recovery the next day.`,
        detail: `${pairs.length} days, WHOOP strain and recovery`, stat: { r: c.r, p: c.p, n: pairs.length }, effect: Math.abs(c.r || 0),
        chart: { type: 'scatter', points: pairs, fit: c, xFormat: fmt0, yFormat: (v) => `${fmt0(v)}%`, label: 'Next-day recovery against day strain' } });
    }
  }

  // 4. Sleep and journal mood.
  {
    const pairs = days.filter(d => d.sleep != null && d.mood != null).map(d => [d.sleep, d.mood]);
    if (pairs.length >= 5) {
      const c = correlation(pairs);
      const hi = mean(pairs.filter(p => p[0] >= 7).map(p => p[1])), lo = mean(pairs.filter(p => p[0] < 6).map(p => p[1]));
      add({ id: 'sleep_mood', area: 'Sleep and mood',
        title: hi != null && lo != null ? `Journal mood averages ${fmt1(hi)} after 7+ hours of sleep and ${fmt1(lo)} below 6.` : `More sleep goes with ${c.r >= 0 ? 'better' : 'worse'} journal mood.`,
        detail: `${pairs.length} journal entries with sleep data`, stat: { r: c.r, p: c.p, n: pairs.length }, effect: Math.abs(c.r || 0),
        chart: { type: 'scatter', points: pairs, fit: c, xFormat: (v) => `${v}h`, yFormat: fmt0, label: 'Journal mood (1 to 5) against hours slept' } });
    }
  }

  // 5. Weekends and calories.
  {
    const wkend = days.filter(d => d.kcal != null && (d.weekday === 5 || d.weekday === 6 || d.weekday === 0)).map(d => d.kcal);
    const wkday = days.filter(d => d.kcal != null && d.weekday >= 1 && d.weekday <= 4).map(d => d.kcal);
    if (wkend.length >= 3 && wkday.length >= 3) {
      const g = compareGroups(wkend, wkday);
      add({ id: 'weekend_kcal', area: 'Food',
        title: Math.abs(g.diff) < 50 ? 'You eat about the same on weekends as on weekdays.' : `You eat about ${fmt0(Math.abs(g.diff))} kcal ${g.diff > 0 ? 'more' : 'less'} on Fridays to Sundays than Monday to Thursday.`,
        detail: `${g.na} weekend and ${g.nb} weekday days logged`, stat: { d: g.d, p: g.p, n: g.na + g.nb }, effect: Math.abs(g.d || 0) / 2,
        chart: { type: 'bars', fmt: fmt0, groups: [{ label: 'Fri to Sun', value: g.ma }, { label: 'Mon to Thu', value: g.mb }], label: `Average calories: weekends ${fmt0(g.ma)}, weekdays ${fmt0(g.mb)}` } });
    }
  }

  // 6. Steps and that night's sleep.
  {
    const lots = [], few = []; const pairs = [];
    days.forEach((d, i) => { const n = next(i); if (d.steps == null || n?.sleep == null) return; pairs.push([d.steps, n.sleep]); (d.steps >= 10000 ? lots : few).push(n.sleep); });
    if (lots.length >= 3 && few.length >= 3) {
      const g = compareGroups(lots, few);
      add({ id: 'steps_sleep', area: 'Activity and sleep',
        title: Math.abs(g.diff) < 0.1 ? 'Your step count makes little difference to how long you sleep.' : `On days with 10,000+ steps you sleep about ${fmt0(Math.abs(g.diff) * 60)} minutes ${g.diff > 0 ? 'longer' : 'less'} that night.`,
        detail: `${pairs.length} days with steps and the following night's sleep`, stat: { d: g.d, p: g.p, n: pairs.length }, effect: Math.abs(g.d || 0) / 2,
        chart: { type: 'bars', fmt: (v) => `${fmt1(v)}h`, groups: [{ label: '10,000+ steps', value: g.ma }, { label: 'Fewer', value: g.mb }], label: `Average sleep: ${fmt1(g.ma)} hours after 10,000+ steps, ${fmt1(g.mb)} after fewer` } });
    }
  }

  // 7. Protein and next-day recovery.
  {
    const pairs = []; days.forEach((d, i) => { const n = next(i); if (d.protein != null && n?.recovery != null) pairs.push([d.protein, n.recovery]); });
    if (pairs.length >= 5) {
      const c = correlation(pairs);
      add({ id: 'protein_recovery', area: 'Food and recovery',
        title: Math.abs(c.r || 0) < 0.12 ? "Protein intake doesn't show a link with next-day recovery." : `Higher-protein days are followed by ${c.r > 0 ? 'higher' : 'lower'} recovery: about ${fmt1(Math.abs(c.slope * 25))} points per 25 g.`,
        detail: `${pairs.length} logged days with next-day recovery`, stat: { r: c.r, p: c.p, n: pairs.length }, effect: Math.abs(c.r || 0),
        chart: { type: 'scatter', points: pairs, fit: c, xFormat: (v) => `${fmt0(v)}g`, yFormat: (v) => `${fmt0(v)}%`, label: 'Next-day recovery against protein eaten' } });
    }
  }

  // 8. Stress and next-morning HRV.
  {
    const pairs = []; days.forEach((d, i) => { const n = next(i); if (d.stress != null && n?.hrv != null) pairs.push([d.stress, n.hrv]); });
    if (pairs.length >= 5) {
      const c = correlation(pairs);
      add({ id: 'stress_hrv', area: 'Mood and recovery',
        title: Math.abs(c.r || 0) < 0.12 ? "Journal stress doesn't show a link with next-morning HRV." : `Each step up in journal stress goes with HRV about ${fmt0(Math.abs(c.slope))} ms ${c.slope < 0 ? 'lower' : 'higher'} the next morning.`,
        detail: `${pairs.length} journal entries with next-day HRV`, stat: { r: c.r, p: c.p, n: pairs.length }, effect: Math.abs(c.r || 0),
        chart: { type: 'scatter', points: pairs, fit: c, xFormat: fmt0, yFormat: (v) => `${fmt0(v)} ms`, label: 'Next-morning HRV against journal stress (1 to 5)' } });
    }
  }

  // 9. Lifting days and calories.
  {
    const lift = days.filter(d => d.kcal != null && d.lifted).map(d => d.kcal), rest = days.filter(d => d.kcal != null && !d.lifted && !d.cardio).map(d => d.kcal);
    if (lift.length >= 3 && rest.length >= 3) {
      const g = compareGroups(lift, rest);
      add({ id: 'lift_kcal', area: 'Training and food',
        title: Math.abs(g.diff) < 50 ? 'You eat about the same on lifting days and rest days.' : `You eat about ${fmt0(Math.abs(g.diff))} kcal ${g.diff > 0 ? 'more' : 'less'} on lifting days than on rest days.`,
        detail: `${g.na} lifting days and ${g.nb} rest days logged`, stat: { d: g.d, p: g.p, n: g.na + g.nb }, effect: Math.abs(g.d || 0) / 2,
        chart: { type: 'bars', fmt: fmt0, groups: [{ label: 'Lifting days', value: g.ma }, { label: 'Rest days', value: g.mb }], label: `Average calories: lifting days ${fmt0(g.ma)}, rest days ${fmt0(g.mb)}` } });
    }
  }

  return out.sort((a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] || b.effect - a.effect);
}

function groupBars(c) {
  const max = Math.max(...c.groups.map(g => g.value || 0), 1);
  return h('div', { class: 'insight-bars', role: 'img', 'aria-label': c.label },
    c.groups.map((g, i) => h('div', { class: 'ib' },
      h('span', { class: 'ib-label' }, g.label),
      h('div', { class: 'ib-track' }, h('div', { class: 'ib-fill' + (i === 0 ? ' a' : ''), style: { width: `${Math.max(4, (g.value / max) * 100)}%` } })),
      h('span', { class: 'ib-val num' }, c.fmt(g.value)))));
}

export async function render(root) {
  root.replaceChildren(loading());
  await loadSummary();
  const today = todayISO();
  const from = addDays(today, -span);
  const extra = await get('insights/data', { from, to: today });
  const days = buildDays(state.summary.days.filter(d => d.date >= from), extra.days, today);
  const all = findInsights(days);
  const real = all.filter(i => i.strength !== 'none');
  const featured = real[0] || null;
  const rest = all.filter(i => i !== featured);
  const refresh = () => render(root);

  const tabs = h('div', { class: 'segmented big', role: 'tablist', 'aria-label': 'Period' },
    [[30, '30 days'], [90, '90 days'], [365, '1 year']].map(([d, l]) => h('button', { role: 'tab', 'aria-selected': String(span === d), onclick: () => { span = d; refresh(); } }, l)));

  const featuredCard = featured ? h('section', { class: 'card insight-hero', 'aria-label': 'Strongest pattern' },
    h('span', { class: 'eyebrow-orange' }, `Strongest pattern, ${featured.area.toLowerCase()}`),
    h('p', { class: 'hero-sentence' }, featured.title),
    featured.chart.type === 'scatter' ? scatter({ ...featured.chart, color: 'var(--on-deep-muted)', fitColor: 'var(--brand-orange)' }) : groupBars(featured.chart),
    h('span', { class: 'small on-deep-muted' }, `${featured.detail}. ${STRENGTH_LABEL[featured.strength]} pattern. A pattern, not proof of cause.`))
    : h('section', { class: 'card', 'aria-label': 'No clear patterns yet' },
      h('h2', null, 'No clear patterns yet'),
      h('p', { class: 'note' }, all.length ? `Nothing stands out over the last ${span} days. That can mean your habits are steady. Try a longer period.` : 'Insights need a few weeks of food logs, WHOOP data or journal entries. Keep logging and check back.'));

  const badge = (s) => h('span', { class: `badge strength-${s}` }, STRENGTH_LABEL[s]);
  const list = rest.length ? h('section', { class: 'card', 'aria-label': 'Other patterns', style: { gap: 0 } },
    h('h2', { style: { marginBottom: '4px' } }, 'Other patterns'),
    h('div', { class: 'list' }, rest.map(i => h('details', { class: 'insight-row' },
      h('summary', null,
        h('span', { class: 'main' }, h('span', { class: 'title' }, i.title), h('span', { class: 'small muted' }, i.detail)),
        badge(i.strength)),
      h('div', { class: 'insight-chart' }, i.chart.type === 'scatter' ? scatter(i.chart) : groupBars(i.chart)))))) : null;

  const waiting = [
    !days.some(d => d.sleep != null) ? 'Connect WHOOP for sleep, recovery, strain and steps.' : null,
    days.filter(d => d.mood != null).length < 5 ? 'Write a few journal entries to see how mood and stress line up with sleep and HRV.' : null,
    'Alcohol and caffeine patterns arrive with the drink counters in the next update.',
  ].filter(Boolean);

  root.replaceChildren(
    pageHead('Patterns in your own data', 'Insights'),
    h('div', { class: 'stack', style: { maxWidth: '820px' } },
      tabs, featuredCard, list,
      h('section', { class: 'card dashed-card', 'aria-label': 'Waiting on more data', style: { gap: '6px' } },
        h('span', { style: { fontWeight: 600 } }, 'Waiting on more data'),
        ...waiting.map(t => h('span', { class: 'small muted' }, t))),
      h('p', { class: 'note small' }, 'Ratings consider how many days a pattern rests on and how consistent it is. Strong patterns are still correlations: other things may explain them.')));
}

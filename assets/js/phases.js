// Diet phases: fat loss, maintenance, diet breaks, reverse diets and lean gains, one after another.
// A phase ends after a number of weeks, when trend weight reaches a number, or (reverse diets) when
// calories reach your expenditure. Weekly check-ins set targets from whichever phase is running.
import { addDays, daysBetween, targetsFor, KCAL_PER_KG } from './tdee.js';

export const PHASE_TYPES = {
  lose: { name: 'Fat loss', color: 'var(--kcal)' },
  maintain: { name: 'Maintenance', color: 'var(--green)' },
  break: { name: 'Diet break', color: 'var(--green)' },
  reverse: { name: 'Reverse diet', color: 'var(--phase-reverse)' },
  gain: { name: 'Lean gain', color: 'var(--lift)' },
};

export const TEMPLATES = [
  { id: 'cut_breaks', name: 'Cut with diet breaks', desc: 'Lose 0.5% a week for 8 weeks, a 2-week break at maintenance, 8 more weeks, then maintain.',
    items: [{ type: 'lose', rate_pct: 0.5, weeks: 8 }, { type: 'break', weeks: 2 }, { type: 'lose', rate_pct: 0.5, weeks: 8 }, { type: 'maintain' }] },
  { id: 'reverse', name: 'Reverse diet', desc: 'Add 75 kcal a week until you reach your expenditure, then maintain.',
    items: [{ type: 'reverse', step_kcal: 75 }, { type: 'maintain' }] },
  { id: 'lean_gain', name: 'Lean gain', desc: 'Gain 0.25% a week for 16 weeks, then maintain.',
    items: [{ type: 'gain', rate_pct: 0.25, weeks: 16 }, { type: 'maintain' }] },
];

const newId = () => Math.random().toString(36).slice(2, 10);
export const withIds = (items) => items.map(i => ({ id: newId(), rate_pct: 0, weeks: null, until_kg: null, step_kcal: null, ...i }));

/** The goal a phase implies for the usual target math. */
export function goalFor(phase) {
  if (!phase) return null;
  if (phase.type === 'lose' || phase.type === 'gain') return { type: phase.type, rate_pct: phase.rate_pct };
  return { type: 'maintain', rate_pct: 0 };
}

/**
 * Lays the phases out on the calendar. Past and current ends come from your data where possible
 * (trend weight crossing a target, a reverse diet reaching expenditure); future ones are projected.
 * ctx: { series: [{date, trend}], trendKg, expenditure, checkins (newest first), today }
 */
export function resolvePhases(plan, ctx) {
  const items = plan?.items || [];
  if (!plan?.start || !items.length) return [];
  const { series = [], today } = ctx;
  let w = ctx.trendKg || 80;
  let start = plan.start;
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const last = i === items.length - 1;
    let end = null, projected = false, done = false;
    const begunBy = start <= today;
    if (p.weeks) {
      end = addDays(start, p.weeks * 7 - 1);
      projected = end >= today;
    } else if (p.until_kg && (p.type === 'lose' || p.type === 'gain')) {
      const hit = begunBy ? series.find(s => s.date >= start && s.date <= today && s.trend != null && (p.type === 'lose' ? s.trend <= p.until_kg : s.trend >= p.until_kg)) : null;
      if (hit) end = hit.date;
      else {
        const from = begunBy ? (ctx.trendKg || w) : w;
        const perWeek = (p.rate_pct / 100) * from;
        const weeks = perWeek > 0 ? Math.max(1, Math.ceil(Math.abs(from - p.until_kg) / perWeek)) : 12;
        end = addDays(start > today ? start : today, weeks * 7 - 1);
        projected = true;
      }
    } else if (p.type === 'reverse') {
      const step = p.step_kcal || 75;
      const reached = begunBy ? [...(ctx.checkins || [])].reverse().find(c => c.date >= start && c.kcal >= c.expenditure - step / 2) : null;
      if (reached) end = addDays(reached.date, -1 + 7);
      else {
        // How far below expenditure the previous phase left you, in weekly steps.
        const latest = begunBy ? ctx.checkins?.[0] : null;
        const prev = out[out.length - 1];
        const gap = latest && latest.date >= start ? Math.max(0, (ctx.expenditure || 0) - latest.kcal)
          : prev?.type === 'lose' ? (prev.rate_pct / 100) * w * KCAL_PER_KG / 7 : 300;
        const weeks = Math.max(1, Math.ceil(gap / step));
        end = addDays(latest && latest.date >= start ? latest.date : (start > today ? start : today), weeks * 7 - 1);
        projected = true;
      }
    } else if (!last) {
      // No end set and not the last phase: treat as 4 weeks so the rest of the plan stays on the calendar.
      end = addDays(start, 27);
      projected = end >= today;
    }
    done = end != null && end < today;
    const status = done ? 'past' : start <= today ? 'current' : 'future';
    // Projected weight at the end, for the list.
    const weeksLong = end ? (daysBetween(start, end) + 1) / 7 : null;
    const startW = status === 'current' ? (ctx.trendKg || w) : w;
    const endW = weeksLong != null && (p.type === 'lose' || p.type === 'gain')
      ? (p.until_kg && !p.weeks ? p.until_kg : startW * (1 + (p.type === 'gain' ? 1 : -1) * (p.rate_pct / 100) * weeksLong)) : startW;
    out.push({ ...p, index: i, start, end, projected, status, weeks_long: weeksLong, end_kg: endW });
    w = endW;
    if (end == null) break;
    start = addDays(end, 1);
  }
  return out;
}

/** The phase that covers a date, or null before the plan starts or after it ends. */
export function phaseOn(resolved, date) {
  return resolved.find(p => p.start <= date && (p.end == null || date <= p.end)) || null;
}

/**
 * Targets a check-in proposes today. Follows the running phase if there is one, otherwise your goal.
 * Reverse diets add their weekly step to the last check-in's calories until they reach expenditure.
 */
export function proposeTargets(model, settings, checkins, today, resolved) {
  const phase = phaseOn(resolved || [], today);
  const trend = model.trendKg || 80;
  if (!phase) return { ...targetsFor(model.expenditure, trend, settings), phase: null };
  const s = { ...settings, goal: { ...settings.goal, ...goalFor(phase) } };
  if (phase.type === 'reverse') {
    const prev = checkins?.[0]?.kcal ?? Math.round(model.expenditure * 0.8);
    const kcal = Math.min(Math.round(model.expenditure / 5) * 5, Math.round((prev + (phase.step_kcal || 75)) / 5) * 5);
    return { ...targetsFor(model.expenditure, trend, s, kcal), phase };
  }
  return { ...targetsFor(model.expenditure, trend, s), phase };
}

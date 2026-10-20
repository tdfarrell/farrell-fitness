// Adaptive expenditure engine.
//
// Idea: over any stretch of days, energy in minus energy out equals the energy stored or
// released by weight change. We know energy in (logged food) and can measure weight change
// from a smoothed trend, so we can solve for energy out (expenditure). The estimate starts
// from a formula-based guess and moves toward what your data says, faster as more days are
// logged, and smoothly so one odd week doesn't swing your targets.

export const KCAL_PER_KG = 7700;       // energy in 1 kg of mixed body tissue
export const TREND_ALPHA = 0.1;        // weight trend smoothing (higher = more responsive)
export const WINDOW = 21;              // days of data per expenditure reading
export const MIN_LOGGED = 7;           // fewest logged days in a window to update the estimate
export const MIN_WEIGHINS = 6;         // fewest weigh-ins in a window to update the estimate
export const EXP_SMOOTH = 0.15;        // how far each day's reading moves the estimate

const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/** Formula-based starting point (Mifflin-St Jeor x activity), or the user's own number. */
export function initialExpenditure(settings, weightKg, year = new Date().getFullYear()) {
  if (settings.initial_expenditure) return Number(settings.initial_expenditure);
  const age = Math.max(15, year - (settings.birth_year || 1985));
  const h = settings.height_cm || 175;
  const bmr = 10 * weightKg + 6.25 * h - 5 * age + (settings.sex === 'female' ? -161 : 5);
  return Math.round(bmr * (ACTIVITY[settings.activity] || 1.55));
}

/** Calories counted toward expenditure for a day, or null if the day shouldn't count. */
export function intakeFor(day, today) {
  if (day.date >= today) return null;               // today isn't finished yet
  if (day.status === 'exclude') return null;
  if (day.status === 'fasted') return 0;
  if (day.status === 'complete') return day.kcal || 0;
  return day.entries > 0 ? day.kcal : null;
}

/** Smoothed weight trend. Gaps between weigh-ins are filled by straight lines first. */
export function weightTrend(days) {
  const idx = days.map((d, i) => (d.weight_kg ? i : -1)).filter(i => i >= 0);
  const out = days.map(() => null);
  if (!idx.length) return out;
  const filled = days.map(d => d.weight_kg || null);
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    for (let i = a + 1; i < b; i++) filled[i] = filled[a] + (filled[b] - filled[a]) * (i - a) / (b - a);
  }
  let t = filled[idx[0]];
  for (let i = idx[0]; i < days.length; i++) {
    if (filled[i] != null) t += TREND_ALPHA * (filled[i] - t);
    out[i] = t;
  }
  return out;
}

function slope(ys) {
  // Least-squares slope of ys against 0..n-1, ignoring nulls.
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  ys.forEach((y, x) => { if (y == null) return; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; });
  if (n < 3) return null;
  const den = n * sxx - sx * sx;
  return den ? (n * sxy - sx * sy) / den : null;
}

/**
 * Run the model over a list of consecutive days ({date, entries, kcal, status, weight_kg}).
 * Returns per-day series plus the latest estimate.
 */
export function computeModel(days, settings, today) {
  const trend = weightTrend(days);
  const firstW = days.find(d => d.weight_kg)?.weight_kg;
  const prior = initialExpenditure(settings, firstW || 80, Number(today.slice(0, 4)));
  const series = [];
  let E = prior;
  let started = false;
  // Readings start only once a full window of real data exists; shorter spans are too noisy.
  const firstIdx = days.findIndex(d => d.weight_kg || d.entries > 0 || d.status === 'fasted');

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const intake = intakeFor(day, today);
    if (trend[i] != null) started = true;
    let reading = null, confidence = 0;
    if (started && firstIdx >= 0 && i - firstIdx >= WINDOW - 1 && day.date < today) {
      const lo = i - WINDOW + 1;
      const kc = [];
      for (let j = lo; j <= i; j++) { const v = intakeFor(days[j], today); if (v != null) kc.push(v); }
      // Rate of change comes from a straight-line fit through the actual weigh-ins in the
      // window. Unlike the smoothed trend, this has no start-up lag.
      const raw = days.slice(lo, i + 1).map(d => d.weight_kg || null);
      const s = raw.filter(v => v != null).length >= MIN_WEIGHINS ? slope(raw) : null;
      if (kc.length >= MIN_LOGGED && s != null) {
        const mean = kc.reduce((a, b) => a + b, 0) / kc.length;
        reading = Math.min(7000, Math.max(1000, mean - s * KCAL_PER_KG));
        confidence = kc.length / WINDOW;
        const target = E + confidence * (reading - E);
        E = E + EXP_SMOOTH * (target - E);
      }
    }
    series.push({ date: day.date, intake, weight: day.weight_kg || null, trend: trend[i], expenditure: started ? E : null, reading, confidence });
  }

  const done = series.filter(s => s.date < today);
  const last = done[done.length - 1] || series[series.length - 1];
  const trendNow = [...series].reverse().find(s => s.trend != null)?.trend ?? null;
  const at = (back) => { const s = series[series.length - 1 - back]; return s?.trend ?? null; };
  const weekly = trendNow != null && at(7) != null ? trendNow - at(7) : null;
  const monthlyRate = trendNow != null && at(28) != null ? (trendNow - at(28)) / 4 : null;
  const logged = done.filter(s => s.intake != null).length;

  return {
    series,
    prior,
    expenditure: last?.expenditure ?? prior,
    trendKg: trendNow,
    weeklyChangeKg: weekly,
    monthlyRateKg: monthlyRate,
    loggedDays: logged,
    hasData: logged >= MIN_LOGGED && series.some(s => s.trend != null),
  };
}

/** Daily targets from an expenditure estimate, trend weight and goal settings. */
export function targetsFor(expenditure, trendKg, settings) {
  const g = settings.goal || {};
  const sign = g.type === 'lose' ? -1 : g.type === 'gain' ? 1 : 0;
  const rateKgWeek = sign * ((g.rate_pct || 0) / 100) * trendKg;
  let kcal = expenditure + (rateKgWeek * KCAL_PER_KG) / 7;
  kcal = Math.max(kcal, 1200, expenditure * 0.6);
  kcal = Math.round(kcal / 5) * 5;

  const m = settings.macros || {};
  let protein = Math.round((m.protein_g_per_kg || 2) * trendKg);
  protein = Math.min(protein, Math.round((kcal * 0.45) / 4));
  const fatShare = { balanced: 0.3, low_fat: 0.2, low_carb: 0.45, keto: null }[m.diet || 'balanced'];
  let fat, carbs;
  if (m.diet === 'keto') {
    carbs = 30;
    fat = Math.round((kcal - protein * 4 - carbs * 4) / 9);
  } else {
    fat = Math.max(Math.round((kcal * fatShare) / 9), Math.round(0.5 * trendKg));
    carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  }
  if (carbs < 0) { carbs = 0; fat = Math.max(0, Math.round((kcal - protein * 4) / 9)); }
  return { kcal, protein, carbs, fat, rateKgWeek };
}

/** Which targets apply today, and whether a weekly check-in is due. */
export function currentTargets(model, settings, checkins, today) {
  if (settings.program === 'manual') {
    const t = settings.manual_targets;
    return { ...t, source: 'manual' };
  }
  const latest = checkins?.[0];
  if (latest) return { kcal: latest.kcal, protein: latest.protein, carbs: latest.carbs, fat: latest.fat, source: 'checkin', date: latest.date };
  const t = targetsFor(model.expenditure, model.trendKg || 80, settings);
  return { ...t, source: 'estimate' };
}

export function checkinStatus(checkins, settings, today) {
  const last = checkins?.[0]?.date;
  const wd = new Date(today + 'T12:00:00Z').getUTCDay();
  const target = settings.checkin_weekday ?? 1;
  let next;
  if (!last) next = today;
  else {
    next = addDays(last, 7);
    // If the scheduled weekday comes around at least 4 days after the last check-in, use it.
    for (let k = 4; k < 7; k++) {
      const d = addDays(last, k);
      if (new Date(d + 'T12:00:00Z').getUTCDay() === target) { next = d; break; }
    }
  }
  const due = settings.program !== 'manual' && today >= next;
  return { last, next, due, daysUntil: daysBetween(today, next), todayIsCheckinDay: wd === target };
}

/** Summary used on the check-in screen for the past 7 completed days. */
export function weekReview(model, today) {
  const week = model.series.filter(s => s.date < today).slice(-7);
  const logged = week.filter(s => s.intake != null);
  const avg = logged.length ? logged.reduce((a, s) => a + s.intake, 0) / logged.length : null;
  const first = week.find(s => s.trend != null)?.trend;
  const last = [...week].reverse().find(s => s.trend != null)?.trend;
  const prevE = model.series.filter(s => s.date < today).slice(-8)[0]?.expenditure;
  return {
    avgIntake: avg,
    daysLogged: logged.length,
    trendChangeKg: first != null && last != null ? last - first : null,
    expenditureChange: prevE != null ? model.expenditure - prevE : null,
  };
}

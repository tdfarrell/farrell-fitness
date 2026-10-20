// Shared app state: settings, the daily summary and the expenditure model built from it.
import { get } from './api.js';
import { computeModel, currentTargets, checkinStatus } from './tdee.js';
import { todayISO } from './ui.js';

export const state = {
  user: null,
  settings: null,
  summary: null,
  model: null,
  targets: null,
  checkin: null,
  stale: true,
};

export function markStale() { state.stale = true; }

export async function loadSummary(force = false) {
  if (!force && !state.stale && state.summary) return state;
  const today = todayISO();
  const from = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const s = await get('summary', { from, to: today });
  state.summary = s;
  state.settings = s.settings;
  state.model = computeModel(s.days, s.settings, today);
  state.targets = currentTargets(state.model, s.settings, s.checkins, today);
  state.checkin = checkinStatus(s.checkins, s.settings, today);
  state.stale = false;
  applyTheme();
  return state;
}

export function applyTheme() {
  if (!state.settings) return;
  const t = state.settings.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('ff_theme', t); } catch {}
}

/* ---------- units ---------- */
const LB = 2.20462;
export const imperial = () => (state.settings?.units || 'imperial') === 'imperial';
export const wUnit = () => (imperial() ? 'lb' : 'kg');
export const toDisplayW = (kg) => (kg == null ? null : imperial() ? kg * LB : kg);
export const fromDisplayW = (v) => (v == null || v === '' ? null : imperial() ? Number(v) / LB : Number(v));
export const fmtW = (kg, digits = 1) => (kg == null ? '-' : toDisplayW(kg).toFixed(digits));
// Strength numbers are shown to the nearest 0.5 lb / 0.25 kg.
export const liftDisplay = (kg) => {
  if (kg == null) return '';
  const v = toDisplayW(kg);
  return imperial() ? String(Math.round(v * 2) / 2) : String(Math.round(v * 4) / 4);
};

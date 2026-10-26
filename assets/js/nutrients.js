// Micronutrients: names, units and default daily targets (US Dietary Reference Intakes for adults).
// "goal" fills toward a target, "limit" warns past a ceiling, "info" just shows the amount.

export const NUTRIENTS = [
  { key: 'fiber', name: 'Fiber', unit: 'g', kind: 'goal', group: 'watch' },
  { key: 'sodium', name: 'Sodium', unit: 'mg', kind: 'limit', group: 'watch' },
  { key: 'sat_fat', name: 'Saturated fat', unit: 'g', kind: 'limit', group: 'watch' },
  { key: 'added_sugar', name: 'Added sugar', unit: 'g', kind: 'limit', group: 'watch' },
  { key: 'sugar', name: 'Total sugar', unit: 'g', kind: 'info', group: 'watch' },
  { key: 'cholesterol', name: 'Cholesterol', unit: 'mg', kind: 'info', group: 'watch' },
  { key: 'vit_d', name: 'Vitamin D', unit: 'mcg', kind: 'goal', group: 'vitamins' },
  { key: 'vit_c', name: 'Vitamin C', unit: 'mg', kind: 'goal', group: 'vitamins' },
  { key: 'vit_a', name: 'Vitamin A', unit: 'mcg', kind: 'goal', group: 'vitamins' },
  { key: 'vit_e', name: 'Vitamin E', unit: 'mg', kind: 'goal', group: 'vitamins' },
  { key: 'vit_k', name: 'Vitamin K', unit: 'mcg', kind: 'goal', group: 'vitamins' },
  { key: 'b6', name: 'Vitamin B6', unit: 'mg', kind: 'goal', group: 'vitamins' },
  { key: 'b12', name: 'Vitamin B12', unit: 'mcg', kind: 'goal', group: 'vitamins' },
  { key: 'folate', name: 'Folate', unit: 'mcg', kind: 'goal', group: 'vitamins' },
  { key: 'potassium', name: 'Potassium', unit: 'mg', kind: 'goal', group: 'minerals' },
  { key: 'magnesium', name: 'Magnesium', unit: 'mg', kind: 'goal', group: 'minerals' },
  { key: 'calcium', name: 'Calcium', unit: 'mg', kind: 'goal', group: 'minerals' },
  { key: 'iron', name: 'Iron', unit: 'mg', kind: 'goal', group: 'minerals' },
  { key: 'zinc', name: 'Zinc', unit: 'mg', kind: 'goal', group: 'minerals' },
];
export const GROUPS = [['watch', 'Watch these'], ['vitamins', 'Vitamins'], ['minerals', 'Minerals']];
export const BY_KEY = Object.fromEntries(NUTRIENTS.map(n => [n.key, n]));

/** Default daily target for a nutrient, or null for "info" ones. kcal sets the saturated fat limit (10% of calories). */
export function defaultTarget(key, settings, kcal) {
  const female = settings?.sex === 'female';
  const age = new Date().getFullYear() - (settings?.birth_year || 1985);
  const older = age >= 51;
  switch (key) {
    case 'fiber': return female ? (older ? 21 : 25) : (older ? 30 : 38);
    case 'sodium': return 2300;
    case 'sat_fat': return Math.round(((kcal || 2000) * 0.1) / 9);
    case 'added_sugar': return female ? 25 : 36;
    case 'vit_a': return female ? 700 : 900;
    case 'vit_c': return female ? 75 : 90;
    case 'vit_d': return age >= 71 ? 20 : 15;
    case 'vit_e': return 15;
    case 'vit_k': return female ? 90 : 120;
    case 'b6': return older ? (female ? 1.5 : 1.7) : 1.3;
    case 'b12': return 2.4;
    case 'folate': return 400;
    case 'potassium': return female ? 2600 : 3400;
    case 'magnesium': return female ? (age < 31 ? 310 : 320) : (age < 31 ? 400 : 420);
    case 'calcium': return (female && older) || age >= 71 ? 1200 : 1000;
    case 'iron': return female && !older ? 18 : 8;
    case 'zinc': return female ? 8 : 11;
    default: return null;
  }
}

/** The target in use: your own if you set one, otherwise the default. */
export function targetFor(key, settings, kcal) {
  const own = settings?.nutrient_targets?.[key];
  return own > 0 ? own : defaultTarget(key, settings, kcal);
}

export function fmtAmount(v, unit) {
  if (v == null) return '-';
  const digits = v >= 100 ? 0 : v >= 10 ? (unit === 'g' ? 0 : 1) : 1;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v)} ${unit}`;
}

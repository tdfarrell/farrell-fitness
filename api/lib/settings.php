<?php
// User settings live as one JSON blob on the users row. Units are stored metric.

function default_settings(): array {
    return [
        'units' => 'imperial',           // imperial (lb) or metric (kg)
        'sex' => 'male',                 // used only for the starting expenditure estimate
        'birth_year' => 1985,
        'height_cm' => 180,
        'activity' => 'moderate',        // sedentary | light | moderate | active | very_active
        'initial_expenditure' => null,   // optional manual starting estimate (kcal)
        'goal' => [
            'type' => 'maintain',        // lose | maintain | gain
            'rate_pct' => 0.5,           // % of body weight per week
            'target_kg' => null,
        ],
        'program' => 'coached',          // coached: weekly check-ins set targets; manual: you set them
        'macros' => [
            'protein_g_per_kg' => 2.0,
            'diet' => 'balanced',        // balanced | low_fat | low_carb | keto
        ],
        'manual_targets' => ['kcal' => 2200, 'protein' => 160, 'carbs' => 220, 'fat' => 75],
        'checkin_weekday' => 1,          // 0 = Sunday ... 6 = Saturday
        'meals' => ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
        'theme' => 'system',             // system | light | dark
        'rest_seconds' => 120,
        'intro_dismissed' => false,      // hide the Getting started card on Today
        'lift_days_goal' => 4,           // lifting sessions per week, for the Train overview
        'body_fat_source' => 'auto',     // auto | tape | scale | manual
        'reminders' => [],               // filled in from default_reminders()
        'nutrient_targets' => [],        // your own daily targets or limits, by nutrient key; blank uses the defaults
        'drinks' => [
            'water_goal_ml' => 2957,     // 100 oz
            'glass_ml' => 237,           // 8 oz
            'bottle_ml' => 710,          // 24 oz
            'caffeine_limit' => 400,     // mg a day
            'caffeine_cutoff' => '14:00',
            'show' => ['water', 'caffeine', 'alcohol'],
            'alcohol_to_log' => true,    // add drink calories to the food log
        ],
        'phases' => [
            'start' => null,             // date the first phase begins
            'items' => [],               // [{id, type, rate_pct, weeks, until_kg, step_kcal}]
        ],
    ];
}

function merge_settings(array $base, array $over): array {
    foreach ($over as $k => $v) {
        if (is_array($v) && isset($base[$k]) && is_array($base[$k]) && array_keys($base[$k]) !== range(0, count($base[$k]) - 1)) {
            $base[$k] = merge_settings($base[$k], $v);
        } else {
            $base[$k] = $v;
        }
    }
    return $base;
}

function get_settings(int $uid): array {
    $raw = q_val('SELECT settings FROM users WHERE id = ?', [$uid]);
    $saved = $raw ? (json_decode($raw, true) ?: []) : [];
    $s = merge_settings(default_settings(), $saved);
    if (function_exists('clean_reminders')) $s['reminders'] = clean_reminders($s['reminders']);
    return $s;
}

function save_settings(int $uid, array $patch): array {
    $allowed = array_keys(default_settings());
    $patch = array_intersect_key($patch, array_flip($allowed));
    $s = merge_settings(get_settings($uid), $patch);

    // Light validation of the fields that feed calculations.
    $s['units'] = in_array($s['units'], ['imperial', 'metric'], true) ? $s['units'] : 'imperial';
    $s['sex'] = in_array($s['sex'], ['male', 'female'], true) ? $s['sex'] : 'male';
    $s['goal']['type'] = in_array($s['goal']['type'], ['lose', 'maintain', 'gain'], true) ? $s['goal']['type'] : 'maintain';
    $s['goal']['rate_pct'] = max(0, min(1.5, (float) $s['goal']['rate_pct']));
    $s['program'] = in_array($s['program'], ['coached', 'manual'], true) ? $s['program'] : 'coached';
    $s['macros']['protein_g_per_kg'] = max(0.8, min(3.3, (float) $s['macros']['protein_g_per_kg']));
    $s['macros']['diet'] = in_array($s['macros']['diet'], ['balanced', 'low_fat', 'low_carb', 'keto'], true) ? $s['macros']['diet'] : 'balanced';
    $s['checkin_weekday'] = max(0, min(6, (int) $s['checkin_weekday']));
    $s['height_cm'] = max(100, min(250, (float) $s['height_cm']));
    $s['meals'] = array_values(array_slice(array_filter(array_map(fn($m) => mb_substr(trim((string) $m), 0, 32), (array) $s['meals'])), 0, 8)) ?: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
    $s['rest_seconds'] = max(15, min(600, (int) $s['rest_seconds']));
    $s['intro_dismissed'] = (bool) $s['intro_dismissed'];
    $s['lift_days_goal'] = max(0, min(14, (int) $s['lift_days_goal']));
    $s['body_fat_source'] = in_array($s['body_fat_source'], ['auto', 'tape', 'scale', 'manual'], true) ? $s['body_fat_source'] : 'auto';
    $s['reminders'] = clean_reminders($s['reminders']);
    $nt = [];
    foreach ((array) $s['nutrient_targets'] as $k => $v) {
        if (preg_match('/^[a-z0-9_]{2,16}$/', (string) $k) && is_numeric($v) && $v > 0 && $v < 100000) $nt[$k] = round((float) $v, 2);
    }
    $s['nutrient_targets'] = $nt;
    $dr = &$s['drinks'];
    $dr['water_goal_ml'] = max(250, min(8000, (float) $dr['water_goal_ml']));
    $dr['glass_ml'] = max(30, min(2000, (float) $dr['glass_ml']));
    $dr['bottle_ml'] = max(100, min(3000, (float) $dr['bottle_ml']));
    $dr['caffeine_limit'] = max(0, min(2000, (int) $dr['caffeine_limit']));
    $dr['caffeine_cutoff'] = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) $dr['caffeine_cutoff']) ? $dr['caffeine_cutoff'] : '14:00';
    $dr['show'] = array_values(array_intersect(['water', 'caffeine', 'alcohol'], (array) $dr['show']));
    $dr['alcohol_to_log'] = (bool) $dr['alcohol_to_log'];
    unset($dr);
    $s['phases'] = clean_phases($s['phases']);
    if (isset($s['goal']['target_kg']) && $s['goal']['target_kg'] !== null) $s['goal']['target_kg'] = max(30, min(300, (float) $s['goal']['target_kg']));

    db_update('users', ['settings' => json_encode($s)], ['id' => $uid]);
    return $s;
}

/** Diet phases run one after another from `start`. A phase ends after `weeks`, or when trend weight reaches `until_kg`, or never (the last one). */
function clean_phases($p): array {
    $p = is_array($p) ? $p : [];
    $start = isset($p['start']) && is_string($p['start']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $p['start']) ? $p['start'] : null;
    $items = [];
    foreach (array_slice((array) ($p['items'] ?? []), 0, 24) as $it) {
        if (!is_array($it)) continue;
        $type = in_array($it['type'] ?? '', ['lose', 'maintain', 'gain', 'break', 'reverse'], true) ? $it['type'] : 'maintain';
        $num = fn($k, $lo, $hi) => isset($it[$k]) && is_numeric($it[$k]) ? max($lo, min($hi, (float) $it[$k])) : null;
        $items[] = [
            'id' => preg_match('/^[a-z0-9]{1,16}$/', (string) ($it['id'] ?? '')) ? $it['id'] : bin2hex(random_bytes(4)),
            'type' => $type,
            'rate_pct' => in_array($type, ['lose', 'gain'], true) ? ($num('rate_pct', 0.05, 1.5) ?? 0.5) : 0,
            'weeks' => ($w = $num('weeks', 1, 104)) === null ? null : (int) round($w),
            'until_kg' => in_array($type, ['lose', 'gain'], true) ? $num('until_kg', 30, 300) : null,
            'step_kcal' => $type === 'reverse' ? (int) ($num('step_kcal', 25, 250) ?? 75) : null,
        ];
    }
    return ['start' => $items ? ($start ?? date('Y-m-d')) : null, 'items' => $items];
}

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
    return merge_settings(default_settings(), $saved);
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

    db_update('users', ['settings' => json_encode($s)], ['id' => $uid]);
    return $s;
}

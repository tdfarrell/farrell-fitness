<?php
// Weekly report, the raw per-day data behind Insights, most-logged foods and a few small helpers.

function week_bounds(string $anyDay): array {
    $start = week_start($anyDay); // Monday
    return [$start, date('Y-m-d', strtotime("$start +6 days"))];
}

function training_totals(int $uid, string $from, string $to): array {
    $lifts = q_all('SELECT * FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]);
    $vol = 0.0; $sets = 0;
    foreach ($lifts as $w) {
        foreach (q_all('SELECT reps, weight_kg, warmup FROM workout_sets WHERE workout_id = ?', [$w['id']]) as $s) {
            if ($s['warmup']) continue;
            $sets++; $vol += ((float) $s['weight_kg']) * ((int) $s['reps']);
        }
    }
    $cardio = cardio_sessions($uid, $from, $to);
    return ['lifts' => count($lifts), 'sets' => $sets, 'volume_kg' => round($vol),
        'cardio' => count($cardio), 'distance_m' => round(array_sum(array_map(fn($c) => $c['distance_m'] ?? 0, $cardio))),
        'cardio_s' => array_sum(array_map(fn($c) => $c['duration_s'] ?? 0, $cardio)),
        'active_days' => count(array_unique(array_merge(array_column($lifts, 'date'), array_column($cardio, 'date'))))];
}

/** New strength and cardio records set between $from and $to (each beats everything before $from). */
function records_between(int $uid, string $from, string $to): array {
    $out = [];
    $rows = q_all('SELECT w.date, s.exercise_id, e.name, s.reps, s.weight_kg FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
        JOIN exercises e ON e.id = s.exercise_id WHERE w.user_id = ? AND s.warmup = 0 AND w.date <= ? ORDER BY w.date', [$uid, $to]);
    $before = []; $during = [];
    foreach ($rows as $r) {
        $e = e1rm_kg($r['weight_kg'] === null ? null : (float) $r['weight_kg'], $r['reps'] === null ? null : (int) $r['reps']);
        if ($e === null) continue;
        $id = (int) $r['exercise_id'];
        if ($r['date'] < $from) $before[$id] = max($before[$id] ?? 0, $e);
        elseif (!isset($during[$id]) || $e > $during[$id]['e1rm_kg']) $during[$id] = ['kind' => 'e1rm', 'name' => $r['name'], 'exercise_id' => $id, 'e1rm_kg' => round($e, 2),
            'weight_kg' => (float) $r['weight_kg'], 'reps' => (int) $r['reps'], 'date' => $r['date']];
    }
    foreach ($during as $id => $d) if (isset($before[$id]) && $d['e1rm_kg'] > $before[$id] + 0.01) $out[] = $d;

    $sessions = cardio_sessions($uid, '2000-01-01', $to);
    $best = [];
    foreach ($sessions as $c) {
        if (!$c['distance_m']) continue;
        $a = $c['activity'];
        $pace = $c['distance_m'] >= 1000 && $c['duration_s'] ? $c['duration_s'] / ($c['distance_m'] / 1000) : null;
        if ($c['date'] < $from) {
            $best[$a]['dist'] = max($best[$a]['dist'] ?? 0, $c['distance_m']);
            if ($pace) $best[$a]['pace'] = min($best[$a]['pace'] ?? INF, $pace);
            continue;
        }
        if (isset($best[$a]['dist']) && $c['distance_m'] > $best[$a]['dist']) { $out[] = ['kind' => 'distance', 'name' => $a, 'distance_m' => $c['distance_m'], 'date' => $c['date']]; $best[$a]['dist'] = $c['distance_m']; }
        if ($pace && isset($best[$a]['pace']) && $pace < $best[$a]['pace']) { $out[] = ['kind' => 'pace', 'name' => $a, 'sec_per_km' => round($pace, 1), 'distance_m' => $c['distance_m'], 'date' => $c['date']]; $best[$a]['pace'] = $pace; }
    }
    usort($out, fn($a, $b) => strcmp($b['date'], $a['date']));
    return $out;
}

function route_report_week(int $uid, string $m) {
    $day = param('date') ? req_date() : today();
    [$from, $to] = week_bounds($day);
    $end = min($to, today());
    [$pFrom, $pTo] = week_bounds(date('Y-m-d', strtotime("$from -1 day")));
    $habits = array_values(array_filter(array_map('habit_out', q_all('SELECT * FROM habits WHERE user_id = ? AND active = 1', [$uid])), fn($h) => true));
    $rate = function ($a, $b) use ($uid, $habits) {
        if (!$habits || $a > $b) return null;
        $st = habit_status($uid, $habits, $a, $b);
        $done = 0; $total = 0;
        foreach ($st as $row) { $total += count($row); $done += count(array_filter($row, fn($x) => $x['done'])); }
        return $total ? ['done' => $done, 'total' => $total] : null;
    };
    return [
        'from' => $from, 'to' => $to, 'through' => $end,
        'training' => training_totals($uid, $from, $end),
        'previous' => training_totals($uid, $pFrom, $pTo),
        'records' => records_between($uid, $from, $end),
        'habits' => $rate($from, $end), 'habits_previous' => $rate($pFrom, $pTo),
        'first_date' => q_val('SELECT MIN(d) FROM (SELECT MIN(date) d FROM diary_entries WHERE user_id = ? UNION ALL SELECT MIN(date) d FROM weights WHERE user_id = ? UNION ALL SELECT MIN(date) d FROM workouts WHERE user_id = ?) x', [$uid, $uid, $uid]),
    ];
}

/** Per-day facts that aren't in the summary, for Insights and the Train overview calendar. */
function route_insights_data(int $uid, string $m) {
    $to = param('to') ? valid_date((string) param('to')) : today();
    $from = param('from') ? valid_date((string) param('from')) : date('Y-m-d', strtotime("$to -365 days"));
    $days = [];
    foreach (q_all('SELECT w.date, w.id, w.name, w.duration_min FROM workouts w WHERE w.user_id = ? AND w.date BETWEEN ? AND ? ORDER BY w.date', [$uid, $from, $to]) as $w) {
        $days[$w['date']]['lifts'][] = ['id' => (int) $w['id'], 'name' => $w['name'], 'duration_min' => $w['duration_min'] === null ? null : (int) $w['duration_min']];
    }
    foreach (cardio_sessions($uid, $from, $to) as $c) {
        $days[$c['date']]['cardio'][] = ['id' => $c['id'], 'whoop_id' => $c['whoop_id'], 'activity' => $c['activity'], 'distance_m' => $c['distance_m'], 'duration_s' => $c['duration_s'], 'strain' => $c['strain'] ?? null];
    }
    foreach (q_all('SELECT date, mood, energy, stress, tags FROM journal WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $j) {
        $days[$j['date']]['journal'] = ['mood' => $j['mood'] === null ? null : (int) $j['mood'], 'energy' => $j['energy'] === null ? null : (int) $j['energy'],
            'stress' => $j['stress'] === null ? null : (int) $j['stress'], 'tags' => json_decode($j['tags'] ?? '[]', true) ?: []];
    }
    ksort($days);
    return ['from' => $from, 'to' => $to, 'days' => $days];
}

/** Most-logged foods between two dates. */
function route_foods_top(int $uid, string $m) {
    $to = param('to') ? valid_date((string) param('to')) : today();
    $from = param('from') ? valid_date((string) param('from')) : date('Y-m-d', strtotime("$to -30 days"));
    $rows = q_all('SELECT name, COUNT(*) n, ROUND(SUM(kcal)) kcal FROM diary_entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY name ORDER BY n DESC, name LIMIT 8', [$uid, $from, $to]);
    return ['foods' => array_map(fn($r) => ['name' => $r['name'], 'count' => (int) $r['n'], 'kcal' => (int) $r['kcal']], $rows)];
}

function route_plans_order(int $uid, string $m) {
    foreach (array_values((array) param('ids', [])) as $i => $id) db_update('meal_plans', ['position' => $i], ['id' => (int) $id, 'user_id' => $uid]);
    return ['ok' => true];
}

/** Body screen: every body measurement plus scale readings. */
function route_body(int $uid, string $m) {
    $rows = q_all('SELECT * FROM measurements WHERE user_id = ? AND kind IN (' . implode(',', array_fill(0, count(BODY_KINDS) + 1, '?')) . ') ORDER BY date',
        array_merge([$uid], BODY_KINDS, ['body_fat']));
    $scale = q_all('SELECT date, weight_kg, body_fat, source FROM weights WHERE user_id = ? AND body_fat IS NOT NULL ORDER BY date', [$uid]);
    return [
        'measurements' => array_map(fn($r) => ['id' => (int) $r['id'], 'date' => $r['date'], 'kind' => $r['kind'], 'value' => (float) $r['value']], $rows),
        'scale' => array_map(fn($r) => ['date' => $r['date'], 'weight_kg' => (float) $r['weight_kg'], 'body_fat' => (float) $r['body_fat'], 'source' => $r['source']], $scale),
        'photos' => (int) q_val('SELECT COUNT(*) FROM progress_photos WHERE user_id = ?', [$uid]),
    ];
}

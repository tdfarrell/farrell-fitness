<?php
// Cardio sessions (logged here or imported from WHOOP) and training totals, records and trends.

const CARDIO_ACTIVITIES = ['Run', 'Walk', 'Bike', 'Jump rope', 'Row', 'Swim', 'Hike', 'Elliptical', 'Stairs', 'Other'];

/** WHOOP sports that are lifting, not cardio. Those stay with strength workouts. */
function whoop_is_strength(?string $sport): bool {
    return (bool) preg_match('/strength|weightlifting|powerlifting|functional|crossfit|bodybuilding/i', (string) $sport);
}

/** Map a WHOOP sport name onto this app's activity list. */
function whoop_activity(?string $sport): string {
    $s = strtolower((string) $sport);
    $map = [
        'Run' => '/run|track/', 'Walk' => '/walk/', 'Bike' => '/cycl|bik|spin|peloton/', 'Jump rope' => '/jump ?rope/',
        'Row' => '/row/', 'Swim' => '/swim/', 'Hike' => '/hik|ruck/', 'Elliptical' => '/elliptical/', 'Stairs' => '/stair/',
    ];
    foreach ($map as $a => $re) if (preg_match($re, $s)) return $a;
    return $sport ? mb_substr($sport, 0, 40) : 'Other';
}

function iso_seconds(?string $a, ?string $b): ?int {
    if (!$a || !$b) return null;
    $d = strtotime($b) - strtotime($a);
    return $d > 0 ? $d : null;
}

function local_hhmm(?string $iso): ?string {
    if (!$iso) return null;
    try { $dt = new DateTime($iso); $dt->setTimezone(new DateTimeZone(config()['timezone'] ?? 'UTC')); return $dt->format('H:i'); }
    catch (Throwable $e) { return null; }
}

/**
 * Every cardio session in a date range, newest first. Logged sessions linked to a WHOOP
 * workout are merged with it: your numbers win, WHOOP fills the gaps (strain, zones, calories).
 */
function cardio_sessions(int $uid, string $from, string $to): array {
    $whoop = [];
    foreach (q_all('SELECT * FROM whoop_workouts WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $w) $whoop[$w['whoop_id']] = $w;
    $out = [];
    $linked = [];
    foreach (q_all('SELECT * FROM cardio WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $c) {
        $w = $c['whoop_id'] ? ($whoop[$c['whoop_id']] ?? q_one('SELECT * FROM whoop_workouts WHERE user_id = ? AND whoop_id = ?', [$uid, $c['whoop_id']])) : null;
        if ($w) $linked[$w['whoop_id']] = true;
        $out[] = [
            'source' => 'logged', 'id' => (int) $c['id'], 'whoop_id' => $c['whoop_id'],
            'date' => $c['date'], 'start_time' => $c['start_time'] ?: ($w ? local_hhmm($w['start_at']) : null),
            'activity' => $c['activity'],
            'duration_s' => $c['duration_s'] !== null ? (int) $c['duration_s'] : ($w ? iso_seconds($w['start_at'], $w['end_at']) : null),
            'distance_m' => $c['distance_m'] !== null ? (float) $c['distance_m'] : ($w && $w['distance_m'] !== null ? (float) $w['distance_m'] : null),
            'elevation_m' => $c['elevation_m'] !== null ? (float) $c['elevation_m'] : ($w && $w['altitude_gain_m'] !== null ? (float) $w['altitude_gain_m'] : null),
            'avg_hr' => $c['avg_hr'] !== null ? (int) $c['avg_hr'] : ($w && $w['avg_hr'] !== null ? (int) $w['avg_hr'] : null),
            'max_hr' => $c['max_hr'] !== null ? (int) $c['max_hr'] : ($w && $w['max_hr'] !== null ? (int) $w['max_hr'] : null),
            'kcal' => $c['kcal'] !== null ? (float) $c['kcal'] : ($w && $w['kcal'] !== null ? (float) $w['kcal'] : null),
            'strain' => $w && $w['strain'] !== null ? (float) $w['strain'] : null,
            'zones' => $w && $w['zones'] ? json_decode($w['zones'], true) : null,
            'effort' => $c['effort'] !== null ? (int) $c['effort'] : null,
            'reps' => $c['reps'] !== null ? (int) $c['reps'] : null,
            'notes' => $c['notes'],
        ];
    }
    foreach ($whoop as $id => $w) {
        if (isset($linked[$id]) || whoop_is_strength($w['sport'])) continue;
        $out[] = [
            'source' => 'whoop', 'id' => null, 'whoop_id' => $id, 'sport' => $w['sport'],
            'date' => $w['date'], 'start_time' => local_hhmm($w['start_at']), 'activity' => whoop_activity($w['sport']),
            'duration_s' => iso_seconds($w['start_at'], $w['end_at']),
            'distance_m' => $w['distance_m'] !== null ? (float) $w['distance_m'] : null,
            'elevation_m' => $w['altitude_gain_m'] !== null ? (float) $w['altitude_gain_m'] : null,
            'avg_hr' => $w['avg_hr'] !== null ? (int) $w['avg_hr'] : null, 'max_hr' => $w['max_hr'] !== null ? (int) $w['max_hr'] : null,
            'kcal' => $w['kcal'] !== null ? (float) $w['kcal'] : null, 'strain' => $w['strain'] !== null ? (float) $w['strain'] : null,
            'zones' => $w['zones'] ? json_decode($w['zones'], true) : null,
            'effort' => null, 'reps' => null, 'notes' => null,
        ];
    }
    usort($out, fn($a, $b) => [$b['date'], $b['start_time'] ?? ''] <=> [$a['date'], $a['start_time'] ?? '']);
    return $out;
}

function route_cardio(int $uid, string $m) {
    $to = valid_date((string) param('to', today()));
    $from = valid_date((string) param('from', date('Y-m-d', strtotime("$to -90 days"))));
    return ['sessions' => cardio_sessions($uid, $from, $to)];
}

function route_cardio_get(int $uid, string $m) {
    $c = q_one('SELECT * FROM cardio WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    if (!$c) fail(404, 'Session not found');
    foreach (cardio_sessions($uid, $c['date'], $c['date']) as $s) if ($s['id'] === (int) $c['id']) return ['session' => $s];
    fail(404, 'Session not found');
}

function route_cardio_save(int $uid, string $m) {
    $activity = req_str('activity', 40);
    $int = function ($k, $lo, $hi) { $v = opt_num($k); return $v === null ? null : (int) max($lo, min($hi, round($v))); };
    $flt = function ($k, $lo, $hi) { $v = opt_num($k); return $v === null ? null : max($lo, min($hi, round($v, 2))); };
    $time = (string) param('start_time', '');
    $whoopId = param('whoop_id') ? mb_substr((string) param('whoop_id'), 0, 40) : null;
    if ($whoopId && !q_one('SELECT id FROM whoop_workouts WHERE user_id = ? AND whoop_id = ?', [$uid, $whoopId])) $whoopId = null;
    $data = [
        'date' => req_date(), 'activity' => $activity,
        'start_time' => preg_match('/^\d{2}:\d{2}$/', $time) ? $time : null,
        'duration_s' => $int('duration_s', 1, 86400), 'distance_m' => $flt('distance_m', 0, 1000000),
        'avg_hr' => $int('avg_hr', 30, 250), 'max_hr' => $int('max_hr', 30, 250), 'elevation_m' => $flt('elevation_m', 0, 20000),
        'effort' => $int('effort', 1, 10), 'kcal' => $flt('kcal', 0, 20000), 'reps' => $int('reps', 0, 1000000),
        'notes' => param('notes') ? mb_substr((string) param('notes'), 0, 2000) : null,
        'whoop_id' => $whoopId,
    ];
    if ($data['duration_s'] === null && $data['distance_m'] === null && !$whoopId) fail(400, 'Enter a time or a distance');
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM cardio WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Session not found');
        db_update('cardio', $data, ['id' => $id]);
    } else {
        if ($whoopId && ($existing = q_val('SELECT id FROM cardio WHERE user_id = ? AND whoop_id = ?', [$uid, $whoopId]))) {
            $id = (int) $existing;
            db_update('cardio', $data, ['id' => $id]);
        } else {
            $id = db_insert('cardio', $data + ['user_id' => $uid, 'created_at' => time()]);
        }
    }
    foreach (cardio_sessions($uid, $data['date'], $data['date']) as $s) if ($s['id'] === $id) return ['session' => $s];
    return ['session' => null];
}

function route_cardio_delete(int $uid, string $m) {
    q('DELETE FROM cardio WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/* ---------- totals, records and trends ---------- */

function e1rm_kg(?float $kg, ?int $reps): ?float {
    if (!$kg || !$reps) return null;
    return $kg * (1 + min($reps, 12) / 30);
}

function week_start(string $date): string {
    $n = (int) date('N', strtotime("$date 12:00")) - 1;
    return date('Y-m-d', strtotime("$date 12:00 -$n days")); // Monday (date math, so DST can't shift it)
}

/**
 * Totals for a range, all-time records, and weekly series for charts.
 * Records: strength (best e1RM, heaviest set, most reps at a weight per exercise) and
 * cardio (longest distance and time, best pace per activity).
 */
function route_training_stats(int $uid, string $m) {
    $to = today();
    $from = valid_date((string) param('from', date('Y-m-d', strtotime('-365 days'))));
    $first = q_val('SELECT MIN(d) FROM (SELECT MIN(date) d FROM workouts WHERE user_id = ? UNION ALL SELECT MIN(date) d FROM cardio WHERE user_id = ? UNION ALL SELECT MIN(date) d FROM whoop_workouts WHERE user_id = ?) x', [$uid, $uid, $uid]);
    $allFrom = $first ?: $to;

    // Strength.
    $sets = q_all('SELECT w.id wid, w.date, s.exercise_id, e.name, s.reps, s.weight_kg, s.warmup FROM workout_sets s
        JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id WHERE w.user_id = ? ORDER BY w.date, w.id, s.position', [$uid]);
    $lift = ['workouts' => [], 'sets' => 0, 'reps' => 0, 'volume_kg' => 0.0];
    $perEx = [];
    $weeklyVol = [];
    foreach ($sets as $s) {
        if ($s['warmup']) continue;
        $kg = $s['weight_kg'] === null ? null : (float) $s['weight_kg'];
        $reps = $s['reps'] === null ? null : (int) $s['reps'];
        $vol = ($kg ?? 0) * ($reps ?? 0);
        if ($s['date'] >= $from) {
            $lift['workouts'][$s['wid']] = true; $lift['sets']++; $lift['reps'] += $reps ?? 0; $lift['volume_kg'] += $vol;
        }
        $wk = week_start($s['date']);
        $weeklyVol[$wk] = ($weeklyVol[$wk] ?? 0) + $vol;
        $id = (int) $s['exercise_id'];
        $perEx[$id] ??= ['exercise_id' => $id, 'name' => $s['name'], 'best_e1rm_kg' => null, 'best_e1rm_date' => null, 'best_e1rm_set' => null,
            'heaviest_kg' => null, 'heaviest_date' => null, 'heaviest_reps' => null, 'sessions' => [], 'volume_kg' => 0.0];
        $p = &$perEx[$id];
        $p['sessions'][$s['wid']] = true;
        $p['volume_kg'] += $vol;
        $e = e1rm_kg($kg, $reps);
        if ($e !== null && ($p['best_e1rm_kg'] === null || $e > $p['best_e1rm_kg'] + 1e-9)) {
            $p['best_e1rm_kg'] = round($e, 2); $p['best_e1rm_date'] = $s['date']; $p['best_e1rm_set'] = ['weight_kg' => $kg, 'reps' => $reps];
        }
        if ($kg !== null && $reps && ($p['heaviest_kg'] === null || $kg > $p['heaviest_kg'] + 1e-9)) {
            $p['heaviest_kg'] = $kg; $p['heaviest_date'] = $s['date']; $p['heaviest_reps'] = $reps;
        }
        unset($p);
    }
    $exercises = array_values(array_map(function ($p) { $p['sessions'] = count($p['sessions']); $p['volume_kg'] = round($p['volume_kg']); return $p; }, $perEx));
    usort($exercises, fn($a, $b) => $b['sessions'] <=> $a['sessions'] ?: strcmp($a['name'], $b['name']));

    // Cardio.
    $sessions = cardio_sessions($uid, $allFrom, $to);
    $cardio = ['sessions' => 0, 'distance_m' => 0.0, 'duration_s' => 0, 'by_activity' => []];
    $acts = [];
    $weeklyDist = []; $weeklyTime = [];
    foreach ($sessions as $s) {
        $a = $s['activity'];
        $dist = $s['distance_m'] ?? 0; $dur = $s['duration_s'] ?? 0;
        $wk = week_start($s['date']);
        $weeklyDist[$wk] = ($weeklyDist[$wk] ?? 0) + $dist;
        $weeklyTime[$wk] = ($weeklyTime[$wk] ?? 0) + $dur;
        if ($s['date'] >= $from) {
            $cardio['sessions']++; $cardio['distance_m'] += $dist; $cardio['duration_s'] += $dur;
            $cardio['by_activity'][$a] ??= ['activity' => $a, 'sessions' => 0, 'distance_m' => 0.0, 'duration_s' => 0];
            $cardio['by_activity'][$a]['sessions']++; $cardio['by_activity'][$a]['distance_m'] += $dist; $cardio['by_activity'][$a]['duration_s'] += $dur;
        }
        $acts[$a] ??= ['activity' => $a, 'longest_distance' => null, 'longest_time' => null, 'best_pace' => null, 'most_reps' => null];
        $r = &$acts[$a];
        $ref = ['date' => $s['date'], 'distance_m' => $s['distance_m'], 'duration_s' => $s['duration_s'], 'reps' => $s['reps'], 'id' => $s['id'], 'whoop_id' => $s['whoop_id']];
        if ($s['distance_m'] && (!$r['longest_distance'] || $s['distance_m'] > $r['longest_distance']['distance_m'])) $r['longest_distance'] = $ref;
        if ($s['duration_s'] && (!$r['longest_time'] || $s['duration_s'] > $r['longest_time']['duration_s'])) $r['longest_time'] = $ref;
        // Best average pace, only for sessions of at least 1 km so short bursts don't count.
        if ($s['distance_m'] >= 1000 && $s['duration_s']) {
            $pace = $s['duration_s'] / ($s['distance_m'] / 1000);
            if (!$r['best_pace'] || $pace < $r['best_pace']['sec_per_km']) $r['best_pace'] = $ref + ['sec_per_km' => round($pace, 1)];
        }
        if ($s['reps'] && (!$r['most_reps'] || $s['reps'] > $r['most_reps']['reps'])) $r['most_reps'] = $ref;
        unset($r);
    }
    $cardio['distance_m'] = round($cardio['distance_m']);
    $cardio['by_activity'] = array_values($cardio['by_activity']);
    usort($cardio['by_activity'], fn($a, $b) => $b['sessions'] <=> $a['sessions']);
    $cardioRecords = array_values($acts);
    usort($cardioRecords, function ($a, $b) use ($cardio) {
        $order = array_column($cardio['by_activity'], 'activity');
        $ia = array_search($a['activity'], $order, true); $ib = array_search($b['activity'], $order, true);
        return ($ia === false ? 99 : $ia) <=> ($ib === false ? 99 : $ib);
    });

    // Weekly series, Monday-based, from the earlier of `from` and 12 weeks ago.
    $weeks = [];
    $start = week_start(min($from, date('Y-m-d', strtotime('-12 weeks'))));
    for ($k = $start; $k <= $to; $k = date('Y-m-d', strtotime("$k 12:00 +7 days"))) {
        $weeks[] = ['week' => $k, 'volume_kg' => round($weeklyVol[$k] ?? 0), 'distance_m' => round($weeklyDist[$k] ?? 0), 'duration_s' => (int) ($weeklyTime[$k] ?? 0)];
    }

    return [
        'from' => $from, 'first_date' => $first,
        'strength' => ['workouts' => count($lift['workouts']), 'sets' => $lift['sets'], 'reps' => $lift['reps'], 'volume_kg' => round($lift['volume_kg'])],
        'cardio' => $cardio,
        'exercises' => $exercises,
        'cardio_records' => $cardioRecords,
        'weeks' => $weeks,
    ];
}

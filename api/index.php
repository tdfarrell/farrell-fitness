<?php
// Single entry point for the JSON API: /api/?r=<route>
declare(strict_types=1);

require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/util.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/settings.php';
require __DIR__ . '/lib/foods.php';
require __DIR__ . '/lib/whoop.php';
require __DIR__ . '/lib/plans.php';
require __DIR__ . '/lib/cardio.php';
require __DIR__ . '/lib/health.php';
require __DIR__ . '/lib/habits.php';
require __DIR__ . '/lib/photos.php';
require __DIR__ . '/lib/backup.php';
require __DIR__ . '/lib/push.php';
require __DIR__ . '/lib/reminders.php';
require __DIR__ . '/lib/rest.php';
require __DIR__ . '/lib/sync.php';
require __DIR__ . '/lib/report.php';
require __DIR__ . '/lib/nutrition.php';
require __DIR__ . '/lib/seed.php';
require __DIR__ . '/lib/admin.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$route = trim((string) ($_GET['r'] ?? ''), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    config();
    ensure_schema();
    // Routes that do their own auth / produce non-JSON output.
    if ($route === 'whoop/connect') { route_whoop_connect(); exit; }
    if ($route === 'whoop/callback') { route_whoop_callback(); exit; }
    if ($route === 'cron/whoop') { json_out(route_cron_whoop()); exit; }
    if ($route === 'cron/tick') { cron_key_check(); json_out(run_tick()); exit; }
    // The scale Shortcut signs in with its own key instead of a session.
    if ($route === 'sync/scale') { json_out(route_sync_scale()); exit; }

    require_csrf_header();

    if ($route === 'auth/status') {
        $uid = current_user_id();
        json_out(['user' => $uid ? auth_user_out(session_user($uid)) : null]);
        exit;
    }
    if ($route === 'auth/login') {
        if ($method !== 'POST') fail(405, 'Use POST');
        json_out(['user' => login(req_str('username', 80), (string) param('password', ''), (bool) param('remember', true))]);
        exit;
    }
    if ($route === 'auth/logout') { logout(); json_out(['ok' => true]); exit; }

    $uid = require_user();
    // Someone signed in with a temporary password has to choose their own first.
    if ($route !== 'auth/set_password' && (int) q_val('SELECT must_change_pw FROM users WHERE id = ?', [$uid])) fail(403, 'Choose a new password to continue');
    $handler = 'route_' . str_replace(['/', '-'], '_', $route);
    if ($route === '' || !preg_match('/^[a-z_\/-]+$/', $route) || !function_exists($handler)) fail(404, 'Unknown route');
    json_out($handler($uid, $method));
} catch (HttpError $e) {
    json_out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[farrell-fitness] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    json_out(['error' => 'Server error. Details are in the PHP error log.'], 500);
}

/* ---------- account & settings ---------- */

function route_auth_password(int $uid, string $m) {
    $cur = (string) param('current', '');
    $new = (string) param('new', '');
    $hash = q_val('SELECT password_hash FROM users WHERE id = ?', [$uid]);
    if (!password_verify($cur, $hash)) fail(400, 'Current password is incorrect');
    if (strlen($new) < 10) fail(400, 'New password must be at least 10 characters');
    set_own_password($uid, $new);
    return ['ok' => true];
}

/** Change your own username and display name. Needs your current password. */
function route_auth_account(int $uid, string $m) {
    $row = q_one('SELECT * FROM users WHERE id = ?', [$uid]);
    if (!password_verify((string) param('current', ''), $row['password_hash'])) fail(400, 'Current password is incorrect');
    $data = [];
    if (param('username') !== null) {
        $u = clean_username(param('username'));
        if (q_val('SELECT id FROM users WHERE LOWER(username) = ? AND id <> ?', [$u, $uid])) fail(400, 'That username is taken');
        $data['username'] = $u;
    }
    if (param('name') !== null) $data['display_name'] = mb_substr(trim((string) param('name')), 0, 80) ?: null;
    if ($data) db_update('users', $data, ['id' => $uid]);
    return ['user' => auth_user_out(session_user($uid))];
}

/** Saves a new password, signs out every other device and keeps this one signed in. */
function set_own_password(int $uid, string $new): void {
    if (strlen($new) < 10) fail(400, 'New password must be at least 10 characters');
    db_update('users', ['password_hash' => password_hash($new, PASSWORD_DEFAULT), 'must_change_pw' => 0], ['id' => $uid]);
    end_sessions($uid);
    $u = session_user($uid);
    begin_session($u);
    issue_remember_token($uid);
}

/** After signing in with a temporary password: choose your own, without retyping the temporary one. */
function route_auth_set_password(int $uid, string $m) {
    if (!(int) q_val('SELECT must_change_pw FROM users WHERE id = ?', [$uid])) fail(400, 'Change your password in Settings');
    $new = (string) param('new', '');
    $u = q_one('SELECT username FROM users WHERE id = ?', [$uid]);
    if (strcasecmp($new, $u['username']) === 0) fail(400, "Your password can't be your username");
    set_own_password($uid, $new);
    return ['user' => auth_user_out(session_user($uid))];
}

function route_settings(int $uid, string $m) {
    if ($m === 'POST') return ['settings' => save_settings($uid, body())];
    return ['settings' => get_settings($uid)];
}

/* ---------- food diary ---------- */

function entry_out(array $e): array {
    foreach (['id', 'food_id'] as $k) $e[$k] = $e[$k] === null ? null : (int) $e[$k];
    foreach (['grams', 'quantity', 'kcal', 'protein', 'carbs', 'fat', 'fiber'] as $k) $e[$k] = $e[$k] === null ? null : (float) $e[$k];
    $e['micros'] = !empty($e['micros']) ? json_decode($e['micros'], true) : null;
    unset($e['user_id']);
    return $e;
}

function route_diary(int $uid, string $m) {
    $date = req_date();
    $entries = array_map('entry_out', q_all('SELECT * FROM diary_entries WHERE user_id = ? AND date = ? ORDER BY id', [$uid, $date]));
    $day = q_one('SELECT status, note FROM days WHERE user_id = ? AND date = ?', [$uid, $date]);
    return ['date' => $date, 'entries' => $entries, 'status' => $day['status'] ?? 'auto', 'note' => $day['note'] ?? null];
}

function food_for_entry(int $uid, $food): array {
    if (is_numeric($food)) {
        $row = q_one('SELECT * FROM foods WHERE id = ? AND user_id = ?', [(int) $food, $uid]);
        if (!$row) fail(404, 'Food not found');
        return $row;
    }
    if (!is_array($food)) fail(400, 'Missing food');
    if (!empty($food['id'])) return food_for_entry($uid, (int) $food['id']);
    $id = save_food($uid, $food);
    return q_one('SELECT * FROM foods WHERE id = ?', [$id]);
}

function route_diary_add(int $uid, string $m) {
    $date = req_date();
    $meal = req_str('meal', 32);
    $quick = param('quick');
    if (is_array($quick)) {
        $n = fn($k) => max(0, (float) ($quick[$k] ?? 0));
        $id = db_insert('diary_entries', [
            'user_id' => $uid, 'date' => $date, 'meal' => $meal, 'food_id' => null,
            'name' => mb_substr(trim((string) ($quick['name'] ?? '')) ?: 'Quick add', 0, 255), 'brand' => null,
            'grams' => null, 'quantity' => 1, 'portion_label' => null,
            'kcal' => $n('kcal') ?: ($n('protein') * 4 + $n('carbs') * 4 + $n('fat') * 9),
            'protein' => $n('protein'), 'carbs' => $n('carbs'), 'fat' => $n('fat'), 'fiber' => null,
            'micros' => null, 'created_at' => time(),
        ]);
        return ['entry' => entry_out(q_one('SELECT * FROM diary_entries WHERE id = ?', [$id]))];
    }
    $f = food_for_entry($uid, param('food'));
    $grams = req_num('grams');
    if ($grams <= 0 || $grams > 10000) fail(400, 'Amount must be between 0 and 10,000 g');
    $k = $grams / 100;
    $id = db_insert('diary_entries', [
        'user_id' => $uid, 'date' => $date, 'meal' => $meal, 'food_id' => (int) $f['id'],
        'name' => $f['name'], 'brand' => $f['brand'], 'grams' => $grams,
        'quantity' => opt_num('quantity', 1), 'portion_label' => param('portion_label') ? mb_substr((string) param('portion_label'), 0, 120) : null,
        'kcal' => round($f['kcal'] * $k, 1), 'protein' => round($f['protein'] * $k, 1),
        'carbs' => round($f['carbs'] * $k, 1), 'fat' => round($f['fat'] * $k, 1),
        'fiber' => $f['fiber'] === null ? null : round($f['fiber'] * $k, 1),
        'micros' => entry_micros($f, $grams),
        'created_at' => time(),
    ]);
    q('UPDATE foods SET use_count = use_count + 1, last_used_at = ? WHERE id = ?', [time(), $f['id']]);
    return ['entry' => entry_out(q_one('SELECT * FROM diary_entries WHERE id = ?', [$id]))];
}

function route_diary_update(int $uid, string $m) {
    $id = (int) req_num('id');
    $e = q_one('SELECT * FROM diary_entries WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$e) fail(404, 'Entry not found');
    $data = [];
    if (param('meal')) $data['meal'] = req_str('meal', 32);
    if (param('date')) $data['date'] = req_date();
    $grams = opt_num('grams');
    if ($grams !== null && $e['grams'] > 0) {
        $ratio = $grams / $e['grams'];
        foreach (['kcal', 'protein', 'carbs', 'fat', 'fiber'] as $k) {
            if ($e[$k] !== null) $data[$k] = round($e[$k] * $ratio, 1);
        }
        if (!empty($e['micros'])) {
            $mm = json_decode($e['micros'], true) ?: [];
            foreach ($mm as $mk => $mv) $mm[$mk] = round($mv * $ratio, 3);
            $data['micros'] = json_encode($mm);
        }
        $data['grams'] = $grams;
        $data['quantity'] = opt_num('quantity', (float) $e['quantity']);
        $data['portion_label'] = param('portion_label', $e['portion_label']);
    } elseif ($e['food_id'] === null) {
        // Quick-add entries edit their numbers directly.
        foreach (['kcal', 'protein', 'carbs', 'fat'] as $k) if (($v = opt_num($k)) !== null) $data[$k] = $v;
        if (param('name')) $data['name'] = req_str('name');
    }
    if ($data) db_update('diary_entries', $data, ['id' => $id]);
    return ['entry' => entry_out(q_one('SELECT * FROM diary_entries WHERE id = ?', [$id]))];
}

function route_diary_delete(int $uid, string $m) {
    q('DELETE FROM diary_entries WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

function route_diary_copy(int $uid, string $m) {
    $from = valid_date((string) param('from'));
    $to = valid_date((string) param('to'));
    $meal = param('meal');
    $rows = q_all('SELECT * FROM diary_entries WHERE user_id = ? AND date = ?' . ($meal ? ' AND meal = ?' : ''),
        $meal ? [$uid, $from, $meal] : [$uid, $from]);
    foreach ($rows as $r) {
        unset($r['id']);
        $r['date'] = $to;
        $r['created_at'] = time();
        db_insert('diary_entries', $r);
    }
    return ['copied' => count($rows)];
}

function route_day_status(int $uid, string $m) {
    $status = (string) param('status', 'auto');
    if (!in_array($status, ['auto', 'complete', 'fasted', 'exclude'], true)) fail(400, 'Unknown status');
    db_upsert('days', ['user_id' => $uid, 'date' => req_date()], ['status' => $status]);
    return ['ok' => true, 'status' => $status];
}

/* ---------- foods ---------- */

function route_foods_search(int $uid, string $m) {
    $q = trim((string) param('q', ''));
    if (mb_strlen($q) < 2) return ['mine' => [], 'results' => [], 'error' => null];
    return search_foods($uid, mb_substr($q, 0, 100));
}

function route_foods_detail(int $uid, string $m) {
    $id = (string) param('id', '');
    $local = q_one("SELECT * FROM foods WHERE user_id = ? AND source = 'usda' AND source_id = ?", [$uid, $id]);
    $detail = usda_detail($id);
    if ($local) $detail['id'] = (int) $local['id'];
    return ['food' => $detail];
}

function route_foods_barcode(int $uid, string $m) {
    $f = barcode_lookup($uid, (string) param('code', ''));
    if (!$f) fail(404, 'No match for that barcode. Create it as your own food instead.');
    return ['food' => $f];
}

function route_foods_mine(int $uid, string $m) {
    $rows = q_all('SELECT * FROM foods WHERE user_id = ? AND archived = 0 ORDER BY ' .
        (param('sort') === 'recent' ? 'last_used_at DESC' : 'use_count DESC, name') . ' LIMIT 200', [$uid]);
    $kind = param('kind');
    $out = array_map('food_row_out', $rows);
    if ($kind === 'custom') $out = array_values(array_filter($out, fn($f) => $f['source'] === 'custom'));
    if ($kind === 'recipe') $out = array_values(array_filter($out, fn($f) => $f['source'] === 'recipe'));
    if (param('sort') === 'recent') $out = array_values(array_filter($out, fn($f) => $f['use_count'] > 0));
    return ['foods' => $out];
}

function route_foods_save(int $uid, string $m) {
    $f = (array) param('food', []);
    if (!in_array($f['source'] ?? 'custom', ['custom', 'recipe'], true)) $f['source'] = 'custom';
    $id = save_food($uid, $f);
    return ['food' => food_row_out(q_one('SELECT * FROM foods WHERE id = ?', [$id]))];
}

function route_foods_delete(int $uid, string $m) {
    db_update('foods', ['archived' => 1], ['id' => (int) req_num('id'), 'user_id' => $uid]);
    return ['ok' => true];
}

/* ---------- weight ---------- */

function route_weights(int $uid, string $m) {
    $from = valid_date((string) param('from', date('Y-m-d', strtotime('-365 days'))));
    $to = valid_date((string) param('to', today()));
    $rows = q_all('SELECT date, weight_kg, body_fat, source FROM weights WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date', [$uid, $from, $to]);
    return ['weights' => array_map(fn($r) => ['date' => $r['date'], 'weight_kg' => (float) $r['weight_kg'], 'body_fat' => $r['body_fat'] === null ? null : (float) $r['body_fat'], 'source' => $r['source'] ?: 'manual'], $rows)];
}

function route_weights_save(int $uid, string $m) {
    $kg = req_num('weight_kg');
    if ($kg < 25 || $kg > 350) fail(400, 'That weight looks out of range');
    $bf = opt_num('body_fat');
    db_upsert('weights', ['user_id' => $uid, 'date' => req_date()], ['weight_kg' => round($kg, 3), 'body_fat' => $bf, 'source' => 'manual']);
    return ['ok' => true];
}

function route_weights_delete(int $uid, string $m) {
    q('DELETE FROM weights WHERE user_id = ? AND date = ?', [$uid, req_date()]);
    return ['ok' => true];
}

/* ---------- training ---------- */

function route_exercises(int $uid, string $m) {
    $rows = q_all('SELECT id, name, muscle, equipment, kind FROM exercises WHERE user_id = ? AND archived = 0 ORDER BY name', [$uid]);
    // The heaviest working set from the last session of each exercise, for the picker.
    $last = [];
    foreach (q_all('SELECT s.exercise_id, w.date, s.weight_kg, s.reps FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
        JOIN (SELECT s2.exercise_id ex, MAX(w2.date) d FROM workout_sets s2 JOIN workouts w2 ON w2.id = s2.workout_id WHERE w2.user_id = ? GROUP BY s2.exercise_id) l
          ON l.ex = s.exercise_id AND l.d = w.date
        WHERE w.user_id = ? AND s.warmup = 0', [$uid, $uid]) as $s) {
        $id = (int) $s['exercise_id'];
        $kg = $s['weight_kg'] === null ? null : (float) $s['weight_kg'];
        if (!isset($last[$id]) || ($kg ?? 0) > ($last[$id]['weight_kg'] ?? 0)) $last[$id] = ['date' => $s['date'], 'weight_kg' => $kg, 'reps' => $s['reps'] === null ? null : (int) $s['reps']];
    }
    return ['exercises' => array_map(fn($r) => ['id' => (int) $r['id']] + $r + ['last' => $last[(int) $r['id']] ?? null], $rows)];
}

function route_exercises_save(int $uid, string $m) {
    $kind = (string) param('kind', 'lift');
    $data = ['name' => req_str('name', 120), 'muscle' => param('muscle') ? mb_substr(trim((string) param('muscle')), 0, 60) : null,
        'equipment' => normalize_equipment(param('equipment')), 'kind' => in_array($kind, EXERCISE_KINDS, true) ? $kind : 'lift'];
    if ($id = (int) param('id', 0)) {
        db_update('exercises', $data, ['id' => $id, 'user_id' => $uid]);
    } else {
        $id = db_insert('exercises', $data + ['user_id' => $uid, 'archived' => 0]);
    }
    return ['exercise' => ['id' => $id] + $data];
}

function route_exercises_delete(int $uid, string $m) {
    db_update('exercises', ['archived' => 1], ['id' => (int) req_num('id'), 'user_id' => $uid]);
    return ['ok' => true];
}

function route_exercises_history(int $uid, string $m) {
    $id = (int) req_num('id');
    $rows = q_all('SELECT w.id AS workout_id, w.date, s.reps, s.weight_kg, s.rpe, s.warmup, s.position
        FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
        WHERE w.user_id = ? AND s.exercise_id = ? ORDER BY w.date DESC, w.id DESC, s.position LIMIT 400', [$uid, $id]);
    $out = [];
    foreach ($rows as $r) {
        $k = $r['workout_id'];
        $out[$k] ??= ['workout_id' => (int) $k, 'date' => $r['date'], 'sets' => []];
        $out[$k]['sets'][] = ['reps' => $r['reps'] === null ? null : (int) $r['reps'], 'weight_kg' => $r['weight_kg'] === null ? null : (float) $r['weight_kg'],
            'rpe' => $r['rpe'] === null ? null : (float) $r['rpe'], 'warmup' => (bool) $r['warmup']];
    }
    return ['history' => array_values($out)];
}

function workout_out(array $w, bool $withSets = true): array {
    $out = ['id' => (int) $w['id'], 'date' => $w['date'], 'name' => $w['name'], 'notes' => $w['notes'],
        'duration_min' => $w['duration_min'] === null ? null : (int) $w['duration_min']];
    $out['effort'] = isset($w['effort']) && $w['effort'] !== null ? (int) $w['effort'] : null;
    $sets = q_all('SELECT s.*, e.name AS exercise, e.kind FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = ? ORDER BY s.position, s.id', [$w['id']]);
    $out['set_count'] = count(array_filter($sets, fn($s) => !$s['warmup']));
    $vol = 0;
    foreach ($sets as $s) if (!$s['warmup'] && kind_in_volume($s['kind'])) $vol += ((float) $s['weight_kg']) * ((int) $s['reps']);
    $out['volume_kg'] = round($vol);
    if ($withSets) {
        $out['sets'] = array_map(fn($s) => [
            'exercise_id' => (int) $s['exercise_id'], 'exercise' => $s['exercise'], 'position' => (int) $s['position'],
            'reps' => $s['reps'] === null ? null : (int) $s['reps'], 'weight_kg' => $s['weight_kg'] === null ? null : (float) $s['weight_kg'],
            'rpe' => $s['rpe'] === null ? null : (float) $s['rpe'], 'warmup' => (bool) $s['warmup'], 'kind' => $s['kind'] ?? 'lift',
        ], $sets);
    } else {
        $out['exercises'] = array_values(array_unique(array_column($sets, 'exercise')));
    }
    return $out;
}

function route_workouts(int $uid, string $m) {
    $from = valid_date((string) param('from', date('Y-m-d', strtotime('-60 days'))));
    $to = valid_date((string) param('to', today()));
    $rows = q_all('SELECT * FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, id DESC LIMIT 200', [$uid, $from, $to]);
    $whoop = q_all('SELECT * FROM whoop_workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY start_at DESC', [$uid, $from, $to]);
    return [
        'workouts' => array_map(fn($w) => workout_out($w, false), $rows),
        'whoop' => array_map(fn($w) => ['id' => $w['whoop_id'], 'date' => $w['date'], 'sport' => $w['sport'], 'start_at' => $w['start_at'], 'end_at' => $w['end_at'],
            'strain' => $w['strain'] === null ? null : (float) $w['strain'], 'kcal' => $w['kcal'] === null ? null : (float) $w['kcal'],
            'avg_hr' => $w['avg_hr'] === null ? null : (int) $w['avg_hr'], 'max_hr' => $w['max_hr'] === null ? null : (int) $w['max_hr'],
            'distance_m' => $w['distance_m'] === null ? null : (float) $w['distance_m'], 'strength' => whoop_is_strength($w['sport'])], $whoop),
    ];
}

function route_workouts_get(int $uid, string $m) {
    $w = q_one('SELECT * FROM workouts WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    if (!$w) fail(404, 'Workout not found');
    return ['workout' => workout_out($w)];
}

function route_workouts_save(int $uid, string $m) {
    $data = [
        'date' => req_date(), 'name' => req_str('name', 120),
        'notes' => param('notes') ? mb_substr((string) param('notes'), 0, 4000) : null,
        'duration_min' => ($d = opt_num('duration_min')) === null ? null : (int) $d,
        'effort' => ($e = opt_num('effort')) === null ? null : (int) max(1, min(10, round($e))),
    ];
    $pdo = db();
    $pdo->beginTransaction();
    try {
        if ($id = (int) param('id', 0)) {
            if (!q_one('SELECT id FROM workouts WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Workout not found');
            db_update('workouts', $data, ['id' => $id]);
            q('DELETE FROM workout_sets WHERE workout_id = ?', [$id]);
        } else {
            $id = db_insert('workouts', $data + ['user_id' => $uid, 'created_at' => time()]);
        }
        $owned = array_flip(array_map('intval', array_column(q_all('SELECT id FROM exercises WHERE user_id = ?', [$uid]), 'id')));
        foreach ((array) param('sets', []) as $i => $s) {
            $ex = (int) ($s['exercise_id'] ?? 0);
            if (!isset($owned[$ex])) continue;
            db_insert('workout_sets', [
                'workout_id' => $id, 'exercise_id' => $ex, 'position' => (int) ($s['position'] ?? $i),
                'reps' => isset($s['reps']) && $s['reps'] !== '' ? (int) $s['reps'] : null,
                'weight_kg' => isset($s['weight_kg']) && $s['weight_kg'] !== '' ? (float) $s['weight_kg'] : null,
                'rpe' => isset($s['rpe']) && $s['rpe'] !== '' && is_numeric($s['rpe']) ? max(1, min(10, round((float) $s['rpe'], 1))) : null,
                'warmup' => !empty($s['warmup']) ? 1 : 0,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return ['workout' => workout_out(q_one('SELECT * FROM workouts WHERE id = ?', [$id]))];
}

function route_workouts_delete(int $uid, string $m) {
    $id = (int) req_num('id');
    if (q_one('SELECT id FROM workouts WHERE id = ? AND user_id = ?', [$id, $uid])) {
        q('DELETE FROM workout_sets WHERE workout_id = ?', [$id]);
        q('DELETE FROM workouts WHERE id = ?', [$id]);
    }
    return ['ok' => true];
}

function route_routines(int $uid, string $m) {
    $rows = q_all('SELECT * FROM routines WHERE user_id = ? ORDER BY name', [$uid]);
    return ['routines' => array_map(fn($r) => routine_out($r), $rows)];
}

function routine_out(array $r): array {
    $ids = json_decode($r['exercise_ids'], true) ?: [];
    $plan = json_decode($r['plan'] ?? 'null', true);
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'exercise_ids' => $ids, 'plan' => is_array($plan) && count($plan) === count($ids) ? $plan : null];
}

/** Planned sets for each exercise in a routine, in the same order: [{sets: [{weight_kg, reps, warmup}]}]. */
function clean_plan($plan, int $n): ?array {
    if (!is_array($plan)) return null;
    $out = [];
    for ($i = 0; $i < $n; $i++) {
        $sets = [];
        foreach (array_slice((array) ($plan[$i]['sets'] ?? []), 0, 20) as $s) {
            if (!is_array($s)) continue;
            $w = isset($s['weight_kg']) && is_numeric($s['weight_kg']) ? round(max(0, min(1000, (float) $s['weight_kg'])), 2) : null;
            $r = isset($s['reps']) && is_numeric($s['reps']) ? (int) max(0, min(1000, (int) $s['reps'])) : null;
            $sets[] = ['weight_kg' => $w, 'reps' => $r, 'warmup' => !empty($s['warmup'])];
        }
        $out[] = ['sets' => $sets];
    }
    return $out;
}

function route_routines_save(int $uid, string $m) {
    $ids = array_values(array_map('intval', (array) param('exercise_ids', [])));
    $plan = clean_plan(param('plan'), count($ids));
    $data = ['name' => req_str('name', 120), 'exercise_ids' => json_encode($ids), 'plan' => $plan === null ? null : json_encode($plan)];
    if ($id = (int) param('id', 0)) db_update('routines', $data, ['id' => $id, 'user_id' => $uid]);
    else $id = db_insert('routines', $data + ['user_id' => $uid]);
    return ['routine' => routine_out(['id' => $id] + $data)];
}

function route_routines_delete(int $uid, string $m) {
    q('DELETE FROM routines WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/* ---------- summary, check-ins ---------- */

/** Everything the expenditure engine and dashboard need, one row per day. */
function route_summary(int $uid, string $m) {
    $to = valid_date((string) param('to', today()));
    $from = valid_date((string) param('from', date('Y-m-d', strtotime("$to -120 days"))));
    $days = [];
    $cur = new DateTime($from);
    $end = new DateTime($to);
    while ($cur <= $end) { $days[$cur->format('Y-m-d')] = ['date' => $cur->format('Y-m-d'), 'entries' => 0, 'kcal' => 0, 'protein' => 0, 'carbs' => 0, 'fat' => 0, 'fiber' => 0, 'status' => 'auto', 'weight_kg' => null, 'whoop' => null]; $cur->modify('+1 day'); }

    foreach (q_all('SELECT date, COUNT(*) n, SUM(kcal) kcal, SUM(protein) p, SUM(carbs) c, SUM(fat) f, SUM(fiber) fi FROM diary_entries WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY date', [$uid, $from, $to]) as $r) {
        if (!isset($days[$r['date']])) continue;
        $days[$r['date']] = array_merge($days[$r['date']], ['entries' => (int) $r['n'], 'kcal' => round((float) $r['kcal']), 'protein' => round((float) $r['p']), 'carbs' => round((float) $r['c']), 'fat' => round((float) $r['f']), 'fiber' => round((float) $r['fi'])]);
    }
    foreach (q_all('SELECT date, status FROM days WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $r) {
        if (isset($days[$r['date']])) $days[$r['date']]['status'] = $r['status'];
    }
    foreach (q_all('SELECT date, weight_kg FROM weights WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $r) {
        if (isset($days[$r['date']])) $days[$r['date']]['weight_kg'] = (float) $r['weight_kg'];
    }
    foreach (q_all('SELECT * FROM whoop_daily WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $r) {
        $d = $r['date'];
        if (!isset($days[$d])) continue;
        $w = [];
        foreach ($r as $k => $v) {
            if (in_array($k, ['id', 'user_id', 'date', 'cycle_id'], true)) continue;
            $w[$k] = $v === null ? null : (float) $v;
        }
        $days[$d]['whoop'] = $w;
    }

    $first = q_val('SELECT MIN(date) FROM weights WHERE user_id = ?', [$uid]);
    return [
        'from' => $from, 'to' => $to,
        'days' => array_values($days),
        'first_weight_date' => $first,
        'settings' => get_settings($uid),
        'checkins' => route_checkins($uid, 'GET')['checkins'],
        'whoop' => whoop_status($uid),
    ];
}

function route_checkins(int $uid, string $m) {
    $rows = q_all('SELECT * FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 104', [$uid]);
    return ['checkins' => array_map(fn($r) => [
        'id' => (int) $r['id'], 'date' => $r['date'], 'expenditure' => (float) $r['expenditure'],
        'trend_kg' => $r['trend_kg'] === null ? null : (float) $r['trend_kg'],
        'kcal' => (int) $r['kcal'], 'protein' => (int) $r['protein'], 'carbs' => (int) $r['carbs'], 'fat' => (int) $r['fat'],
        'detail' => json_decode($r['detail'] ?? 'null', true),
    ], $rows)];
}

function route_checkins_save(int $uid, string $m) {
    $data = [
        'expenditure' => req_num('expenditure'),
        'trend_kg' => opt_num('trend_kg'),
        'kcal' => (int) round(req_num('kcal')), 'protein' => (int) round(req_num('protein')),
        'carbs' => (int) round(req_num('carbs')), 'fat' => (int) round(req_num('fat')),
        'detail' => json_encode(param('detail')),
    ];
    if ($data['kcal'] < 800 || $data['kcal'] > 8000) fail(400, 'Calorie target out of range');
    db_upsert('checkins', ['user_id' => $uid, 'date' => req_date()], $data);
    return route_checkins($uid, 'GET');
}

function route_checkins_delete(int $uid, string $m) {
    q('DELETE FROM checkins WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/* ---------- WHOOP ---------- */

function route_whoop_status(int $uid, string $m) { return whoop_status($uid); }

function route_whoop_sync(int $uid, string $m) {
    $days = param('days');
    return whoop_sync($uid, $days === null ? null : max(1, (int) $days));
}

function route_whoop_disconnect(int $uid, string $m) {
    $row = q_one('SELECT * FROM whoop_tokens WHERE user_id = ?', [$uid]);
    if ($row) {
        try { http_request('DELETE', WHOOP_API . '/v2/user/access', ['Authorization' => 'Bearer ' . whoop_access_token($uid)]); } catch (Throwable $e) {}
        q('DELETE FROM whoop_tokens WHERE user_id = ?', [$uid]);
    }
    // Disconnecting also deletes everything synced from WHOOP.
    q('DELETE FROM whoop_daily WHERE user_id = ?', [$uid]);
    q('DELETE FROM whoop_workouts WHERE user_id = ?', [$uid]);
    return ['ok' => true];
}

function route_whoop_connect(): void {
    $uid = current_user_id();
    if (!$uid) { header('Location: ' . base_url() . '/#/login'); return; }
    header('Location: ' . whoop_authorize_url());
}

function route_whoop_callback(): void {
    $back = base_url() . '/#/settings';
    try {
        $uid = require_user();
        if (!empty($_GET['error'])) fail(400, 'WHOOP access was not granted');
        whoop_handle_callback($uid, (string) ($_GET['code'] ?? ''), (string) ($_GET['state'] ?? ''));
        try { whoop_sync($uid); } catch (Throwable $e) { error_log('[farrell-fitness] first WHOOP sync: ' . $e->getMessage()); }
        header("Location: $back?whoop=connected");
    } catch (Throwable $e) {
        header("Location: $back?whoop_error=" . rawurlencode($e->getMessage()));
    }
}

function cron_key_check(): void {
    $secret = (string) (config()['cron_secret'] ?? '');
    if (strlen($secret) < 16 || str_starts_with($secret, 'CHANGE_ME') || !hash_equals($secret, (string) ($_GET['key'] ?? ''))) fail(403, 'Bad cron key');
}

function route_cron_whoop(): array {
    cron_key_check();
    return run_whoop_cron();
}

/* ---------- export ---------- */

function route_export(int $uid, string $m) {
    $t = fn($sql) => q_all($sql, [$uid]);
    return [
        'exported_at' => date('c'),
        'settings' => get_settings($uid),
        'diary' => $t('SELECT date, meal, name, brand, grams, quantity, portion_label, kcal, protein, carbs, fat, fiber, micros FROM diary_entries WHERE user_id = ? ORDER BY date, id'),
        'days' => $t('SELECT date, status, note FROM days WHERE user_id = ? ORDER BY date'),
        'weights' => $t('SELECT date, weight_kg, body_fat, source FROM weights WHERE user_id = ? ORDER BY date'),
        'foods' => $t('SELECT source, source_id, name, brand, barcode, kcal, protein, carbs, fat, fiber, sugar, sodium, micros, portions, recipe FROM foods WHERE user_id = ? AND archived = 0'),
        'exercises' => $t('SELECT id, name, muscle, equipment, kind FROM exercises WHERE user_id = ?'),
        'routines' => array_map('routine_out', $t('SELECT * FROM routines WHERE user_id = ? ORDER BY name')),
        'workouts' => array_map(fn($w) => workout_out($w), $t('SELECT * FROM workouts WHERE user_id = ? ORDER BY date')),
        'checkins' => $t('SELECT date, expenditure, trend_kg, kcal, protein, carbs, fat FROM checkins WHERE user_id = ? ORDER BY date'),
        'whoop_daily' => $t('SELECT * FROM whoop_daily WHERE user_id = ? ORDER BY date'),
        'whoop_workouts' => $t('SELECT * FROM whoop_workouts WHERE user_id = ? ORDER BY date'),
        'meal_plans' => array_map('plan_out', $t('SELECT * FROM meal_plans WHERE user_id = ? ORDER BY position, id')),
        'cardio' => $t('SELECT date, start_time, activity, setting, duration_s, distance_m, avg_hr, max_hr, elevation_m, incline_pct, laps, lap_m, lap_times, resistance, cadence, watts, effort, kcal, reps, notes, whoop_id FROM cardio WHERE user_id = ? ORDER BY date'),
        'medications_and_supplements' => array_map(fn($r) => array_intersect_key(health_item_out($r), array_flip(['id', 'name', 'dose', 'kind', 'frequency', 'schedule', 'supply', 'active', 'remind', 'refill_remind'])),
            $t('SELECT * FROM health_items WHERE user_id = ? ORDER BY position, id')),
        'doses_taken' => $t('SELECT item_id, date, slot, taken_at FROM med_doses WHERE user_id = ? ORDER BY date, item_id, slot'),
        'progress_photos' => array_map('photo_out', $t('SELECT * FROM progress_photos WHERE user_id = ? ORDER BY date, pose')),
        'lab_results' => $t('SELECT date, marker, value, unit, ref_low, ref_high, note FROM labs WHERE user_id = ? ORDER BY date, marker'),
        'blood_sugar' => $t('SELECT date, time, mg_dl, context, note FROM glucose WHERE user_id = ? ORDER BY date, time'),
        'measurements' => $t('SELECT date, kind, value, value2, note FROM measurements WHERE user_id = ? ORDER BY date'),
        'habits' => $t('SELECT id, name, slot, kind, target, active FROM habits WHERE user_id = ? ORDER BY position, id'),
        'habit_logs' => $t('SELECT habit_id, date, done, value FROM habit_logs WHERE user_id = ? ORDER BY date'),
        'journal' => array_map('journal_out', $t('SELECT * FROM journal WHERE user_id = ? ORDER BY date')),
    ];
}

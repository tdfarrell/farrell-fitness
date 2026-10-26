<?php
// Stretching and mobility: a library of stretches, routines built from them (which can be a warm-up
// or cool-down for a strength routine or a cardio activity), and logged sessions from the guided timer.

const STRETCH_AREAS = ['Hips', 'Hamstrings', 'Quads', 'Glutes', 'Calves', 'Back', 'Shoulders', 'Chest', 'Neck', 'Full body'];

/** [name, area, hold seconds, per side, reps (shown instead of a hold for drills), cue] */
function default_stretches(): array {
    return [
        ['Leg swings, front to back', 'Hips', 30, true, 12, 'Hold something for balance and swing from the hip, a little higher each time.'],
        ['Leg swings, side to side', 'Hips', 30, true, 12, 'Swing across your body and out, keeping your hips square.'],
        ['Walking lunge with reach', 'Full body', 45, false, 10, 'Step long, drop the back knee, reach both arms overhead.'],
        ['High knees', 'Full body', 30, false, null, 'Quick feet, knees to hip height, stay tall.'],
        ['Butt kicks', 'Quads', 30, false, null, 'Heels toward your glutes, light and quick.'],
        ['Hip circles', 'Hips', 30, true, 8, 'Knee up, draw a big circle out and around.'],
        ['Ankle rocks', 'Calves', 30, true, 15, 'Knee toward the wall over your toes, heel stays down.'],
        ['Arm circles', 'Shoulders', 30, false, 15, 'Small to big, then reverse.'],
        ['Couch stretch', 'Quads', 60, true, null, 'Back knee against the wall, squeeze the glute, keep your chest up.'],
        ['Pigeon pose', 'Glutes', 45, true, null, 'Front shin across, hips square, fold forward as far as is comfortable.'],
        ['90/90 switches', 'Hips', 45, false, 10, 'Sit tall, rotate both knees side to side without using your hands if you can.'],
        ['Frog stretch', 'Hips', 60, false, null, 'Knees wide on the floor, rock your hips back slowly.'],
        ['Standing hamstring stretch', 'Hamstrings', 45, true, null, 'Heel on a low step, hinge from the hips with a flat back.'],
        ['Seated forward fold', 'Hamstrings', 45, false, null, 'Legs straight, reach for your shins or toes, breathe out as you fold.'],
        ['Kneeling hip flexor stretch', 'Hips', 45, true, null, 'Tuck your pelvis, shift forward until you feel the front of the hip.'],
        ['Figure-4 stretch', 'Glutes', 45, true, null, 'On your back, ankle over knee, pull the bottom leg toward you.'],
        ['Calf stretch at a wall', 'Calves', 45, true, null, 'Back leg straight, heel down, lean into the wall.'],
        ["Child's pose", 'Back', 45, false, null, 'Knees wide, sit back toward your heels, arms long.'],
        ['Cat-cow', 'Back', 45, false, 10, 'On hands and knees, round up then arch, slow with your breath.'],
        ['Thread the needle', 'Back', 30, true, null, 'From all fours, slide one arm under and rest your shoulder down.'],
        ['Doorway chest stretch', 'Chest', 45, true, null, 'Forearm on the frame, elbow at shoulder height, step through.'],
        ['Cross-body shoulder stretch', 'Shoulders', 30, true, null, 'Pull the arm across at chest height, shoulder down.'],
        ['Overhead triceps stretch', 'Shoulders', 30, true, null, 'Hand behind your head, gently press the elbow back.'],
        ['Neck side stretch', 'Neck', 30, true, null, 'Ear toward shoulder, opposite shoulder down.'],
    ];
}

/** Starter routines: [name, [stretch names]] */
function default_stretch_routines(): array {
    return [
        ['Pre-run warm-up', ['Leg swings, front to back', 'Leg swings, side to side', 'Hip circles', 'Walking lunge with reach', 'High knees', 'Ankle rocks']],
        ['Post-lift cool-down', ["Child's pose", 'Couch stretch', 'Pigeon pose', 'Standing hamstring stretch', 'Doorway chest stretch', 'Cross-body shoulder stretch', 'Overhead triceps stretch', 'Cat-cow']],
        ['Hip opener', ['90/90 switches', 'Kneeling hip flexor stretch', 'Pigeon pose', 'Frog stretch', 'Figure-4 stretch']],
    ];
}

function seed_stretches(int $uid): void {
    if ((int) q_val('SELECT COUNT(*) FROM stretches WHERE user_id = ?', [$uid]) > 0) return;
    $ids = [];
    foreach (default_stretches() as [$n, $a, $hold, $side, $reps, $cue]) {
        $ids[$n] = db_insert('stretches', ['user_id' => $uid, 'name' => $n, 'area' => $a, 'hold_s' => $hold, 'per_side' => $side ? 1 : 0,
            'reps' => $reps, 'cue' => $cue, 'custom' => 0, 'archived' => 0]);
    }
    foreach (default_stretch_routines() as $i => [$name, $list]) {
        db_insert('stretch_routines', ['user_id' => $uid, 'name' => $name, 'position' => $i, 'attach' => json_encode([]),
            'items' => json_encode(array_map(fn($n) => ['stretch_id' => $ids[$n]], $list))]);
    }
}

function stretch_out(array $r): array {
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'area' => $r['area'], 'hold_s' => (int) $r['hold_s'], 'per_side' => (bool) $r['per_side'],
        'reps' => $r['reps'] === null ? null : (int) $r['reps'], 'cue' => $r['cue'], 'custom' => (bool) $r['custom']];
}

/** Attach: [{type: 'routine', id, when: 'before'|'after'} | {type: 'cardio', activity, when}] */
function clean_attach($a, int $uid): array {
    $out = [];
    $routines = array_flip(array_map('intval', array_column(q_all('SELECT id FROM routines WHERE user_id = ?', [$uid]), 'id')));
    foreach (array_slice((array) $a, 0, 30) as $x) {
        if (!is_array($x)) continue;
        $when = ($x['when'] ?? '') === 'after' ? 'after' : 'before';
        if (($x['type'] ?? '') === 'routine' && isset($routines[(int) ($x['id'] ?? 0)])) $out[] = ['type' => 'routine', 'id' => (int) $x['id'], 'when' => $when];
        elseif (($x['type'] ?? '') === 'cardio' && in_array($x['activity'] ?? '', CARDIO_ACTIVITIES, true)) $out[] = ['type' => 'cardio', 'activity' => $x['activity'], 'when' => $when];
    }
    return array_values(array_unique($out, SORT_REGULAR));
}

function stretch_routine_out(array $r, array $byId): array {
    $items = [];
    foreach ((json_decode($r['items'] ?? '[]', true) ?: []) as $it) {
        $s = $byId[(int) ($it['stretch_id'] ?? 0)] ?? null;
        if (!$s) continue; // a deleted stretch drops out of the routine
        $items[] = ['stretch_id' => $s['id'], 'hold_s' => isset($it['hold_s']) ? (int) $it['hold_s'] : $s['hold_s']];
    }
    $total = 0;
    foreach ($items as $it) { $s = $byId[$it['stretch_id']]; $total += $it['hold_s'] * ($s['per_side'] ? 2 : 1) + 5; }
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'items' => $items, 'attach' => json_decode($r['attach'] ?? '[]', true) ?: [],
        'est_s' => $total, 'position' => (int) $r['position']];
}

function route_stretch(int $uid, string $m) {
    seed_stretches($uid);
    $byId = [];
    foreach (q_all('SELECT * FROM stretches WHERE user_id = ? AND archived = 0 ORDER BY name', [$uid]) as $r) $byId[(int) $r['id']] = stretch_out($r);
    $routines = array_map(fn($r) => stretch_routine_out($r, $byId), q_all('SELECT * FROM stretch_routines WHERE user_id = ? ORDER BY position, id', [$uid]));
    $weekFrom = week_start(today());
    $week = q_all('SELECT date, duration_s FROM stretch_sessions WHERE user_id = ? AND date >= ?', [$uid, $weekFrom]);
    $recent = q_all('SELECT * FROM stretch_sessions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 20', [$uid]);
    return ['stretches' => array_values($byId), 'routines' => $routines, 'areas' => STRETCH_AREAS,
        'week' => ['sessions' => count($week), 'minutes' => (int) round(array_sum(array_column($week, 'duration_s')) / 60)],
        'recent' => array_map('stretch_session_out', $recent)];
}

function stretch_session_out(array $r): array {
    return ['id' => (int) $r['id'], 'date' => $r['date'], 'name' => $r['name'], 'routine_id' => $r['routine_id'] === null ? null : (int) $r['routine_id'],
        'duration_s' => (int) $r['duration_s'], 'stretches' => (int) $r['stretches']];
}

function route_stretch_save(int $uid, string $m) {
    $hold = (int) max(5, min(600, (int) param('hold_s', 30)));
    $area = in_array(param('area'), STRETCH_AREAS, true) ? param('area') : 'Full body';
    $reps = opt_num('reps');
    $data = ['name' => req_str('name', 80), 'area' => $area, 'hold_s' => $hold, 'per_side' => param('per_side') ? 1 : 0,
        'reps' => $reps === null ? null : (int) max(1, min(200, $reps)), 'cue' => param('cue') ? mb_substr(trim((string) param('cue')), 0, 240) : null];
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM stretches WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Stretch not found');
        db_update('stretches', $data, ['id' => $id]);
    } else {
        $id = db_insert('stretches', $data + ['user_id' => $uid, 'custom' => 1, 'archived' => 0]);
    }
    return ['stretch' => stretch_out(q_one('SELECT * FROM stretches WHERE id = ?', [$id]))];
}

function route_stretch_delete(int $uid, string $m) {
    db_update('stretches', ['archived' => 1], ['id' => (int) req_num('id'), 'user_id' => $uid]);
    return ['ok' => true];
}

function route_stretch_routines_save(int $uid, string $m) {
    $owned = array_flip(array_map('intval', array_column(q_all('SELECT id FROM stretches WHERE user_id = ? AND archived = 0', [$uid]), 'id')));
    $items = [];
    foreach (array_slice((array) param('items', []), 0, 40) as $it) {
        $sid = (int) ($it['stretch_id'] ?? 0);
        if (!isset($owned[$sid])) continue;
        $items[] = ['stretch_id' => $sid] + (isset($it['hold_s']) && is_numeric($it['hold_s']) ? ['hold_s' => (int) max(5, min(600, $it['hold_s']))] : []);
    }
    if (!$items) fail(400, 'Add at least one stretch');
    $data = ['name' => req_str('name', 80), 'items' => json_encode($items), 'attach' => json_encode(clean_attach(param('attach', []), $uid))];
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM stretch_routines WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Routine not found');
        db_update('stretch_routines', $data, ['id' => $id]);
    } else {
        $id = db_insert('stretch_routines', $data + ['user_id' => $uid, 'position' => (int) q_val('SELECT COUNT(*) FROM stretch_routines WHERE user_id = ?', [$uid])]);
    }
    return route_stretch($uid, $m) + ['id' => $id];
}

function route_stretch_routines_delete(int $uid, string $m) {
    $id = (int) req_num('id');
    q('DELETE FROM stretch_routines WHERE id = ? AND user_id = ?', [$id, $uid]);
    // Scheduled sessions that used it as a warm-up or cool-down simply lose it.
    q('UPDATE workout_schedule SET warmup_id = NULL WHERE user_id = ? AND warmup_id = ?', [$uid, $id]);
    q('UPDATE workout_schedule SET cooldown_id = NULL WHERE user_id = ? AND cooldown_id = ?', [$uid, $id]);
    q("DELETE FROM workout_schedule WHERE user_id = ? AND kind = 'stretch' AND ref_id = ?", [$uid, $id]);
    return ['ok' => true];
}

/** Log a session from the guided timer (or by hand). */
function route_stretch_log(int $uid, string $m) {
    $rid = (int) param('routine_id', 0);
    $r = $rid ? q_one('SELECT * FROM stretch_routines WHERE id = ? AND user_id = ?', [$rid, $uid]) : null;
    $dur = (int) max(10, min(4 * 3600, (int) param('duration_s', 0)));
    $id = db_insert('stretch_sessions', ['user_id' => $uid, 'date' => req_date(), 'routine_id' => $r ? $rid : null,
        'name' => $r ? $r['name'] : (param('name') ? mb_substr(trim((string) param('name')), 0, 80) : 'Stretching'),
        'duration_s' => $dur, 'stretches' => (int) max(0, min(100, (int) param('stretches', 0))), 'created_at' => time()]);
    return ['session' => stretch_session_out(q_one('SELECT * FROM stretch_sessions WHERE id = ?', [$id]))];
}

function route_stretch_sessions_delete(int $uid, string $m) {
    q('DELETE FROM stretch_sessions WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

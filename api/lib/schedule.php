<?php
// Workout schedule: strength, cardio and stretching sessions on a weekly pattern, every few days, or
// once. Single dates can be skipped or moved. Each planned date is matched against what was actually
// logged that day, so the app can show planned against done and remind you before a session.

const SCHEDULE_KINDS = ['strength', 'cardio', 'stretch'];
const SCHEDULE_REPEATS = ['weekly', 'days', 'once'];

function schedule_row_out(array $r, array $names): array {
    $ref = $r['ref_id'] === null ? null : (int) $r['ref_id'];
    $title = $r['kind'] === 'strength' ? ($names['routine'][$ref] ?? $r['title'])
        : ($r['kind'] === 'stretch' ? ($names['stretch'][$ref] ?? $r['title']) : ($r['title'] ?: $r['activity']));
    return [
        'id' => (int) $r['id'], 'kind' => $r['kind'], 'ref_id' => $ref, 'activity' => $r['activity'], 'setting' => $r['setting'],
        'title' => $title ?: 'Workout', 'detail' => $r['detail'], 'repeat' => $r['repeat_kind'],
        'weekdays' => json_decode($r['weekdays'] ?? '[]', true) ?: [], 'every_n' => (int) $r['every_n'],
        'start_date' => $r['start_date'], 'end_date' => $r['end_date'], 'time' => $r['time'],
        'remind_min' => $r['remind_min'] === null ? null : (int) $r['remind_min'],
        'warmup_id' => $r['warmup_id'] === null ? null : (int) $r['warmup_id'], 'cooldown_id' => $r['cooldown_id'] === null ? null : (int) $r['cooldown_id'],
        'exceptions' => (object) (json_decode($r['exceptions'] ?? '{}', true) ?: []),
    ];
}

function schedule_names(int $uid): array {
    $out = ['routine' => [], 'stretch' => []];
    foreach (q_all('SELECT id, name FROM routines WHERE user_id = ?', [$uid]) as $r) $out['routine'][(int) $r['id']] = $r['name'];
    foreach (q_all('SELECT id, name FROM stretch_routines WHERE user_id = ?', [$uid]) as $r) $out['stretch'][(int) $r['id']] = $r['name'];
    return $out;
}

/** Does a schedule row fall on $date by its pattern (before skips and moves)? */
function schedule_on(array $s, string $date): bool {
    if ($date < $s['start_date'] || ($s['end_date'] && $date > $s['end_date'])) return false;
    switch ($s['repeat']) {
        case 'once': return $date === $s['start_date'];
        case 'days':
            $n = max(1, $s['every_n']);
            $diff = (int) round((strtotime("$date 12:00") - strtotime("{$s['start_date']} 12:00")) / 86400);
            return $diff % $n === 0;
        default: // weekly, every N weeks counted from the start date's week
            if (!in_array((int) date('w', strtotime("$date 12:00")), $s['weekdays'], true)) return false;
            $n = max(1, $s['every_n']);
            $weeks = (int) round((strtotime(week_start($date) . ' 12:00') - strtotime(week_start($s['start_date']) . ' 12:00')) / (7 * 86400));
            return $weeks % $n === 0;
    }
}

/** Every planned session between two dates, with skips and moves applied, sorted by date and time. */
function schedule_occurrences(array $rows, string $from, string $to): array {
    $out = [];
    foreach ($rows as $s) {
        $ex = (array) $s['exceptions'];
        // Step by calendar day from noon, so clock changes can't skip or repeat a date.
        for ($d = max($from, $s['start_date']); $d <= $to; $d = date('Y-m-d', strtotime("$d 12:00 +1 day"))) {
            if (!schedule_on($s, $d)) continue;
            $e = $ex[$d] ?? null;
            if ($e === 'skip' || (is_array($e) && !empty($e['skip']))) continue;
            if (is_array($e) && !empty($e['date'])) continue; // moved: added below on its new date
            $out[] = schedule_occ($s, $d, $s['time'], null);
        }
        // Moved dates, wherever they came from, if they land in the range.
        foreach ($ex as $orig => $e) {
            if (!is_array($e) || empty($e['date']) || $e['date'] < $from || $e['date'] > $to) continue;
            if (!schedule_on($s, $orig)) continue;
            $out[] = schedule_occ($s, $e['date'], $e['time'] ?? $s['time'], $orig);
        }
    }
    usort($out, fn($a, $b) => [$a['date'], $a['time'] ?? '99:99'] <=> [$b['date'], $b['time'] ?? '99:99']);
    return $out;
}

function schedule_occ(array $s, string $date, ?string $time, ?string $movedFrom): array {
    return ['schedule_id' => $s['id'], 'date' => $date, 'time' => $time, 'moved_from' => $movedFrom, 'kind' => $s['kind'], 'title' => $s['title'],
        'detail' => $s['detail'], 'ref_id' => $s['ref_id'], 'activity' => $s['activity'], 'setting' => $s['setting'],
        'warmup_id' => $s['warmup_id'], 'cooldown_id' => $s['cooldown_id'], 'remind_min' => $s['remind_min'], 'repeat' => $s['repeat'], 'done' => false];
}

/** Marks planned sessions done when something of that kind was logged that day (the matching one first). */
function schedule_mark_done(int $uid, array $occ, string $from, string $to): array {
    if (!$occ) return $occ;
    $logged = ['strength' => [], 'cardio' => [], 'stretch' => []];
    foreach (q_all('SELECT id, date, name FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $w) $logged['strength'][$w['date']][] = ['key' => $w['name'], 'used' => false];
    foreach (cardio_sessions($uid, $from, $to) as $c) $logged['cardio'][$c['date']][] = ['key' => $c['activity'], 'used' => false];
    foreach (q_all('SELECT date, routine_id FROM stretch_sessions WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $x) $logged['stretch'][$x['date']][] = ['key' => (int) $x['routine_id'], 'used' => false];
    $keyOf = fn($o) => $o['kind'] === 'strength' ? $o['title'] : ($o['kind'] === 'cardio' ? $o['activity'] : $o['ref_id']);
    foreach ([true, false] as $exact) {
        foreach ($occ as &$o) {
            if ($o['done']) continue;
            foreach ($logged[$o['kind']][$o['date']] ?? [] as $i => $l) {
                if ($l['used'] || ($exact && $l['key'] != $keyOf($o))) continue;
                $logged[$o['kind']][$o['date']][$i]['used'] = true;
                $o['done'] = true;
                break;
            }
        }
        unset($o);
    }
    return $occ;
}

function schedule_rows(int $uid): array {
    $names = schedule_names($uid);
    return array_map(fn($r) => schedule_row_out($r, $names), q_all('SELECT * FROM workout_schedule WHERE user_id = ? ORDER BY time, id', [$uid]));
}

/** Rows plus the planned sessions in a range (default: this week through four weeks out), marked done or not. */
function route_schedule(int $uid, string $m) {
    $from = param('from') ? valid_date((string) param('from')) : week_start(today());
    $to = param('to') ? valid_date((string) param('to')) : date('Y-m-d', strtotime(today() . ' 12:00 +28 days'));
    if ((strtotime($to) - strtotime($from)) / 86400 > 400) fail(400, 'Ask for a year or less');
    $rows = schedule_rows($uid);
    $occ = schedule_mark_done($uid, schedule_occurrences($rows, $from, $to), $from, min($to, today()));
    return ['schedule' => $rows, 'occurrences' => $occ, 'from' => $from, 'to' => $to];
}

function route_schedule_save(int $uid, string $m) {
    $kind = (string) param('kind', 'strength');
    if (!in_array($kind, SCHEDULE_KINDS, true)) fail(400, 'Unknown session type');
    $repeat = in_array(param('repeat'), SCHEDULE_REPEATS, true) ? param('repeat') : 'weekly';
    $ref = (int) param('ref_id', 0) ?: null;
    if ($kind === 'strength' && (!$ref || !q_one('SELECT id FROM routines WHERE id = ? AND user_id = ?', [$ref, $uid]))) fail(400, 'Choose a routine');
    if ($kind === 'stretch' && (!$ref || !q_one('SELECT id FROM stretch_routines WHERE id = ? AND user_id = ?', [$ref, $uid]))) fail(400, 'Choose a stretching routine');
    $activity = $kind === 'cardio' ? (string) param('activity', 'Run') : null;
    if ($kind === 'cardio' && !in_array($activity, CARDIO_ACTIVITIES, true)) fail(400, 'Choose an activity');
    $setting = $kind === 'cardio' && in_array(param('setting'), CARDIO_SETTINGS[$activity] ?? [], true) ? param('setting') : null;
    $days = array_values(array_unique(array_filter(array_map('intval', (array) param('weekdays', [])), fn($d) => $d >= 0 && $d <= 6)));
    sort($days);
    if ($repeat === 'weekly' && !$days) fail(400, 'Pick at least one day');
    $time = (string) param('time', '');
    $stretchOk = function ($id) use ($uid) { $id = (int) $id; return $id && q_one('SELECT id FROM stretch_routines WHERE id = ? AND user_id = ?', [$id, $uid]) ? $id : null; };
    $remind = param('remind_min');
    $data = [
        'kind' => $kind, 'ref_id' => $kind === 'cardio' ? null : $ref, 'activity' => $activity, 'setting' => $setting,
        'title' => param('title') ? mb_substr(trim((string) param('title')), 0, 80) : null,
        'detail' => param('detail') ? mb_substr(trim((string) param('detail')), 0, 80) : null,
        'repeat_kind' => $repeat, 'weekdays' => json_encode($repeat === 'weekly' ? $days : []),
        'every_n' => (int) max(1, min(60, (int) param('every_n', 1))),
        'start_date' => param('start_date') ? valid_date((string) param('start_date')) : today(),
        'end_date' => param('end_date') ? valid_date((string) param('end_date')) : null,
        'time' => preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time) ? $time : null,
        'remind_min' => $remind === null || $remind === '' ? null : (int) max(0, min(24 * 60, (int) $remind)),
        'warmup_id' => $kind === 'stretch' ? null : $stretchOk(param('warmup_id')),
        'cooldown_id' => $kind === 'stretch' ? null : $stretchOk(param('cooldown_id')),
    ];
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM workout_schedule WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Not found');
        db_update('workout_schedule', $data, ['id' => $id]);
    } else {
        $id = db_insert('workout_schedule', $data + ['user_id' => $uid, 'exceptions' => '{}', 'created_at' => time()]);
    }
    return route_schedule($uid, $m) + ['id' => $id];
}

function route_schedule_delete(int $uid, string $m) {
    q('DELETE FROM workout_schedule WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return route_schedule($uid, $m);
}

/** Skip one date, move it (to another date and time), or undo either. `date` is the planned date. */
function route_schedule_exception(int $uid, string $m) {
    $row = q_one('SELECT * FROM workout_schedule WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    if (!$row) fail(404, 'Not found');
    $date = req_date();
    $ex = json_decode($row['exceptions'] ?? '{}', true) ?: [];
    $action = (string) param('action', 'skip');
    if ($action === 'restore') unset($ex[$date]);
    elseif ($action === 'skip') $ex[$date] = 'skip';
    elseif ($action === 'move') {
        $to = valid_date((string) param('to_date', ''));
        $time = (string) param('to_time', '');
        $ex[$date] = ['date' => $to] + (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time) ? ['time' => $time] : []);
    } else fail(400, 'Unknown action');
    // Old exceptions (more than 60 days ago) are dropped so the list stays small.
    $cut = date('Y-m-d', strtotime(today() . ' 12:00 -60 days'));
    $ex = array_filter($ex, fn($v, $k) => $k >= $cut, ARRAY_FILTER_USE_BOTH);
    db_update('workout_schedule', ['exceptions' => json_encode((object) $ex)], ['id' => $row['id']]);
    return route_schedule($uid, $m);
}

/** Reminders before today's planned sessions that haven't been started. Called from run_reminders_for(). */
function schedule_reminders(int $uid, int $now, callable $send, callable $mark): void {
    $date = date('Y-m-d', $now);
    $rows = array_filter(schedule_rows($uid), fn($r) => $r['remind_min'] !== null && $r['time']);
    if (!$rows) return;
    $occ = schedule_mark_done($uid, schedule_occurrences(array_values($rows), $date, $date), $date, $date);
    foreach ($occ as $o) {
        if (!$o['time'] || $o['remind_min'] === null) continue;
        $at = strtotime("$date {$o['time']}");
        $key = "sched:{$o['schedule_id']}";
        if ($now < $at - $o['remind_min'] * 60 || $now >= $at + 30 * 60 || reminder_sent($uid, $key, $date)) continue;
        if ($o['done']) { $mark($key); continue; }
        $when = $o['remind_min'] ? ($now < $at ? 'at ' . date('g:i a', $at) : 'now') : 'now';
        $url = $o['kind'] === 'strength' ? "#/train/new?routine={$o['ref_id']}" : ($o['kind'] === 'stretch' ? "#/train/stretch/run/{$o['ref_id']}" : '#/train/cardio/new');
        $send($key, ['title' => $o['title'] . ($o['detail'] ? ", {$o['detail']}" : ''), 'body' => "Scheduled $when. Tap to start.", 'url' => $url]);
    }
}

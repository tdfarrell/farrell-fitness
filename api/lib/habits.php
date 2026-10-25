<?php
// Daily habit checklist and the journal.
// Some habit kinds check themselves off from other data: steps and sleep from WHOOP,
// weigh-in from the weight log, meds from the Health checklist, journal from today's entry.

const HABIT_SLOTS = ['morning', 'day', 'evening'];
const HABIT_KINDS = ['check', 'minutes', 'count', 'steps', 'sleep', 'weigh_in', 'meds', 'log_food', 'journal'];

function default_habits(): array {
    return [
        ['Brush teeth', 'morning', 'check', null], ['Weigh in', 'morning', 'weigh_in', null], ['Meds and supplements', 'morning', 'meds', null],
        ['7+ hours of sleep', 'morning', 'sleep', 7],
        ['10,000 steps', 'day', 'steps', 10000], ['Time outside', 'day', 'minutes', 30], ['Stretch', 'day', 'minutes', 10],
        ['Brush teeth', 'evening', 'check', null], ['Floss', 'evening', 'check', null], ['Journal', 'evening', 'journal', null],
    ];
}

function seed_habits(int $uid): void {
    $s = get_settings($uid);
    if (!empty($s['habits_seeded']) || (int) q_val('SELECT COUNT(*) FROM habits WHERE user_id = ?', [$uid]) > 0) return;
    foreach (default_habits() as $i => [$name, $slot, $kind, $target]) {
        db_insert('habits', ['user_id' => $uid, 'name' => $name, 'slot' => $slot, 'kind' => $kind, 'target' => $target, 'active' => 1, 'position' => $i, 'created_at' => time()]);
    }
    $raw = q_val('SELECT settings FROM users WHERE id = ?', [$uid]);
    $saved = $raw ? (json_decode($raw, true) ?: []) : [];
    $saved['habits_seeded'] = true;
    db_update('users', ['settings' => json_encode($saved)], ['id' => $uid]);
}

function habit_out(array $r): array {
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'slot' => $r['slot'], 'kind' => $r['kind'],
        'target' => $r['target'] === null ? null : (float) $r['target'], 'active' => (bool) $r['active'], 'position' => (int) $r['position']];
}

/**
 * Status of each habit on each day from $from to $to:
 *   [date => [habit_id => ['done' => bool, 'value' => ?float, 'auto' => bool, 'source' => ?string]]]
 */
function habit_status(int $uid, array $habits, string $from, string $to): array {
    $logs = [];
    foreach (q_all('SELECT habit_id, date, done, value FROM habit_logs WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $l) {
        $logs[$l['date']][(int) $l['habit_id']] = ['done' => (bool) $l['done'], 'value' => $l['value'] === null ? null : (float) $l['value']];
    }
    $whoop = [];
    foreach (q_all('SELECT date, step_count, sleep_hours FROM whoop_daily WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $w) $whoop[$w['date']] = $w;
    $weighed = array_flip(array_column(q_all('SELECT date FROM weights WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]), 'date'));
    $food = array_flip(array_column(q_all('SELECT DISTINCT date FROM diary_entries WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]), 'date'));
    $journal = array_flip(array_column(q_all('SELECT date FROM journal WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]), 'date'));
    $activeMeds = (int) q_val('SELECT COUNT(*) FROM health_items WHERE user_id = ? AND active = 1', [$uid]);
    $doses = [];
    foreach (q_all('SELECT d.date, COUNT(*) n FROM health_doses d JOIN health_items i ON i.id = d.item_id WHERE d.user_id = ? AND i.active = 1 AND d.date BETWEEN ? AND ? GROUP BY d.date', [$uid, $from, $to]) as $r) $doses[$r['date']] = (int) $r['n'];

    $out = [];
    for ($t = strtotime($from); $t <= strtotime($to); $t += 86400) {
        $d = date('Y-m-d', $t);
        foreach ($habits as $h) {
            $id = $h['id'];
            $log = $logs[$d][$id] ?? null;
            $value = $log['value'] ?? null;
            $auto = null; $source = null;
            switch ($h['kind']) {
                case 'steps':
                    $steps = isset($whoop[$d]['step_count']) && $whoop[$d]['step_count'] !== null ? (float) $whoop[$d]['step_count'] : null;
                    if ($steps !== null) { $value = $steps; $auto = $steps >= ($h['target'] ?: 10000); $source = 'whoop'; }
                    break;
                case 'sleep':
                    $hrs = isset($whoop[$d]['sleep_hours']) && $whoop[$d]['sleep_hours'] !== null ? (float) $whoop[$d]['sleep_hours'] : null;
                    if ($hrs !== null) { $value = $hrs; $auto = $hrs >= ($h['target'] ?: 7); $source = 'whoop'; }
                    break;
                case 'weigh_in': $auto = isset($weighed[$d]); $source = 'weight'; break;
                case 'log_food': $auto = isset($food[$d]); $source = 'food'; break;
                case 'journal': $auto = isset($journal[$d]); $source = 'journal'; break;
                case 'meds':
                    if ($activeMeds > 0) { $value = $doses[$d] ?? 0; $auto = ($doses[$d] ?? 0) >= $activeMeds; $source = 'meds'; }
                    break;
                case 'minutes': case 'count':
                    if ($value !== null && $h['target']) $auto = $value >= $h['target'];
                    break;
            }
            $done = ($auto === true) || ($log['done'] ?? false);
            $out[$d][$id] = ['done' => $done, 'value' => $value, 'auto' => $auto !== null, 'source' => $source];
        }
    }
    return $out;
}

/** Habits with today's status, streaks, and a completion history for the heat map. */
function route_habits(int $uid, string $m) {
    seed_habits($uid);
    $date = param('date') ? req_date() : today();
    $days = max(7, min(120, (int) param('days', 63)));
    $from = date('Y-m-d', strtotime("$date -" . ($days - 1) . ' days'));
    $all = array_map('habit_out', q_all('SELECT * FROM habits WHERE user_id = ? ORDER BY position, id', [$uid]));
    $active = array_values(array_filter($all, fn($h) => $h['active']));
    $status = habit_status($uid, $active, $from, $date);
    $history = [];
    foreach ($status as $d => $row) $history[] = ['date' => $d, 'done' => count(array_filter($row, fn($x) => $x['done'])), 'total' => count($row)];
    $out = [];
    foreach ($active as $h) {
        // Streak: consecutive done days ending today, or ending yesterday if today isn't done yet.
        $streak = 0;
        $t = strtotime($date);
        if (empty($status[$date][$h['id']]['done'])) $t -= 86400;
        for (; $t >= strtotime($from); $t -= 86400) {
            if (!empty($status[date('Y-m-d', $t)][$h['id']]['done'])) $streak++; else break;
        }
        $out[] = $h + $status[$date][$h['id']] + ['streak' => $streak];
    }
    return ['date' => $date, 'habits' => $out, 'all' => $all, 'history' => $history];
}

function route_habits_log(int $uid, string $m) {
    $id = (int) req_num('habit_id');
    if (!q_one('SELECT id FROM habits WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Habit not found');
    $value = opt_num('value');
    db_upsert('habit_logs', ['habit_id' => $id, 'date' => req_date()], ['user_id' => $uid, 'done' => param('done', true) ? 1 : 0, 'value' => $value]);
    return ['ok' => true];
}

function route_habits_save(int $uid, string $m) {
    $slot = (string) param('slot', 'day');
    $kind = (string) param('kind', 'check');
    $data = [
        'name' => req_str('name', 80),
        'slot' => in_array($slot, HABIT_SLOTS, true) ? $slot : 'day',
        'kind' => in_array($kind, HABIT_KINDS, true) ? $kind : 'check',
        'target' => ($t = opt_num('target')) === null ? null : max(0, min(1000000, $t)),
        'active' => param('active', true) ? 1 : 0,
    ];
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM habits WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Habit not found');
        db_update('habits', $data, ['id' => $id]);
    } else {
        $id = db_insert('habits', $data + ['user_id' => $uid, 'created_at' => time(),
            'position' => (int) q_val('SELECT COALESCE(MAX(position), 0) + 1 FROM habits WHERE user_id = ?', [$uid])]);
    }
    return ['habit' => habit_out(q_one('SELECT * FROM habits WHERE id = ?', [$id]))];
}

function route_habits_order(int $uid, string $m) {
    foreach (array_values((array) param('ids', [])) as $i => $id) db_update('habits', ['position' => $i], ['id' => (int) $id, 'user_id' => $uid]);
    return ['ok' => true];
}

function route_habits_delete(int $uid, string $m) {
    $id = (int) req_num('id');
    if (q_one('SELECT id FROM habits WHERE id = ? AND user_id = ?', [$id, $uid])) {
        q('DELETE FROM habit_logs WHERE habit_id = ?', [$id]);
        q('DELETE FROM habits WHERE id = ?', [$id]);
    }
    return ['ok' => true];
}

/* ---------- journal ---------- */

function journal_out(?array $r): ?array {
    if (!$r) return null;
    return ['date' => $r['date'], 'mood' => $r['mood'] === null ? null : (int) $r['mood'], 'energy' => $r['energy'] === null ? null : (int) $r['energy'],
        'stress' => $r['stress'] === null ? null : (int) $r['stress'], 'body' => $r['body'] ?? '', 'tags' => json_decode($r['tags'] ?? '[]', true) ?: [],
        'context' => json_decode($r['context'] ?? 'null', true), 'updated_at' => (int) $r['updated_at']];
}

/** A snapshot of the day saved with each entry, so patterns are visible later. */
function journal_context(int $uid, string $date): array {
    $w = q_one('SELECT recovery, sleep_hours, strain, step_count FROM whoop_daily WHERE user_id = ? AND date = ?', [$uid, $date]) ?: [];
    $kcal = q_val('SELECT SUM(kcal) FROM diary_entries WHERE user_id = ? AND date = ?', [$uid, $date]);
    $lifts = array_column(q_all('SELECT name FROM workouts WHERE user_id = ? AND date = ?', [$uid, $date]), 'name');
    $cardio = array_map(fn($s) => $s['activity'] . ($s['distance_m'] ? ' ' . round($s['distance_m'] / 1609.344, 1) . ' mi' : ''), cardio_sessions($uid, $date, $date));
    $habitRow = habit_status($uid, array_values(array_filter(array_map('habit_out', q_all('SELECT * FROM habits WHERE user_id = ? AND active = 1', [$uid])), fn($h) => true)), $date, $date)[$date] ?? [];
    return [
        'recovery' => isset($w['recovery']) ? (int) $w['recovery'] : null,
        'sleep_hours' => isset($w['sleep_hours']) ? (float) $w['sleep_hours'] : null,
        'strain' => isset($w['strain']) ? (float) $w['strain'] : null,
        'steps' => isset($w['step_count']) ? (int) $w['step_count'] : null,
        'kcal' => $kcal === null ? null : round((float) $kcal),
        'workouts' => array_values(array_merge($lifts, $cardio)),
        'habits_done' => count(array_filter($habitRow, fn($x) => $x['done'])), 'habits_total' => count($habitRow),
    ];
}

function route_journal(int $uid, string $m) {
    $date = param('date') ? req_date() : today();
    return ['entry' => journal_out(q_one('SELECT * FROM journal WHERE user_id = ? AND date = ?', [$uid, $date])), 'context' => journal_context($uid, $date)];
}

function route_journal_list(int $uid, string $m) {
    $q = trim((string) param('q', ''));
    $limit = max(1, min(200, (int) param('limit', 30)));
    $rows = $q !== ''
        ? q_all('SELECT * FROM journal WHERE user_id = ? AND (body LIKE ? OR tags LIKE ?) ORDER BY date DESC LIMIT ' . $limit, [$uid, "%$q%", "%$q%"])
        : q_all('SELECT * FROM journal WHERE user_id = ? ORDER BY date DESC LIMIT ' . $limit, [$uid]);
    $tags = [];
    foreach (q_all('SELECT tags FROM journal WHERE user_id = ? ORDER BY date DESC LIMIT 200', [$uid]) as $r) {
        foreach (json_decode($r['tags'] ?? '[]', true) ?: [] as $t) $tags[$t] = ($tags[$t] ?? 0) + 1;
    }
    arsort($tags);
    return ['entries' => array_map('journal_out', $rows), 'tags' => array_slice(array_keys($tags), 0, 30)];
}

function route_journal_save(int $uid, string $m) {
    $date = req_date();
    $scale = function ($k) { $v = opt_num($k); return $v === null ? null : max(1, min(5, (int) round($v))); };
    $tags = array_values(array_unique(array_filter(array_map(fn($t) => mb_substr(trim((string) $t), 0, 32), array_slice((array) param('tags', []), 0, 20)))));
    $data = ['mood' => $scale('mood'), 'energy' => $scale('energy'), 'stress' => $scale('stress'),
        'body' => mb_substr((string) param('body', ''), 0, 20000), 'tags' => json_encode($tags),
        'context' => json_encode(journal_context($uid, $date)), 'updated_at' => time()];
    db_upsert('journal', ['user_id' => $uid, 'date' => $date], $data);
    return ['entry' => journal_out(q_one('SELECT * FROM journal WHERE user_id = ? AND date = ?', [$uid, $date]))];
}

function route_journal_delete(int $uid, string $m) {
    q('DELETE FROM journal WHERE user_id = ? AND date = ?', [$uid, req_date()]);
    return ['ok' => true];
}

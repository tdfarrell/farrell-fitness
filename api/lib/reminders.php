<?php
// Reminders, sent as push notifications by the cron tick. Each one fires once a day at or after
// its time (the tick runs every 15 minutes or so), and is skipped when the thing is already done.
// Missed by more than 3 hours (server down, phone asleep doesn't matter), it's dropped for the day.

const REMINDER_WINDOW_S = 3 * 3600;

function default_reminders(): array {
    return [
        'weigh_in' => ['on' => true, 'time' => '07:00'],
        'meds' => ['on' => true],
        'food' => ['on' => true, 'time' => '20:30', 'min_meals' => 2],
        'photos' => ['on' => true, 'weekday' => 0, 'time' => '08:00'],
        'report' => ['on' => true, 'weekday' => 0, 'time' => '18:00'],
        'checkin' => ['on' => false, 'time' => '08:00'],
    ];
}

function clean_reminders($r): array {
    $out = default_reminders();
    foreach ($out as $k => $def) {
        $v = is_array($r[$k] ?? null) ? $r[$k] : [];
        $out[$k]['on'] = array_key_exists('on', $v) ? (bool) $v['on'] : $def['on'];
        if (isset($def['time'])) $out[$k]['time'] = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) ($v['time'] ?? '')) ? $v['time'] : $def['time'];
        if (isset($def['weekday'])) $out[$k]['weekday'] = isset($v['weekday']) ? max(0, min(6, (int) $v['weekday'])) : $def['weekday'];
        if (isset($def['min_meals'])) $out[$k]['min_meals'] = isset($v['min_meals']) ? max(1, min(8, (int) $v['min_meals'])) : $def['min_meals'];
    }
    return $out;
}

/** True when $hhmm today has passed but by less than the window. */
function reminder_due_now(string $hhmm, int $now): bool {
    $at = strtotime(date('Y-m-d', $now) . " $hhmm");
    return $now >= $at && $now - $at < REMINDER_WINDOW_S;
}

function reminder_sent(int $uid, string $key, string $date): bool {
    return (bool) q_one('SELECT id FROM reminder_log WHERE user_id = ? AND rkey = ? AND date = ?', [$uid, $key, $date]);
}
function reminder_mark(int $uid, string $key, string $date): void {
    try { db_insert('reminder_log', ['user_id' => $uid, 'rkey' => $key, 'date' => $date, 'sent_at' => time()]); } catch (PDOException $e) { /* already marked */ }
}

/** Next check-in date, mirroring the app's rule (7 days after the last, or the chosen weekday if 4+ days later). */
function checkin_next(int $uid, array $s): ?string {
    if (($s['program'] ?? 'coached') === 'manual') return null;
    $last = q_val('SELECT MAX(date) FROM checkins WHERE user_id = ?', [$uid]);
    if (!$last) return today();
    $next = date('Y-m-d', strtotime("$last +7 days"));
    for ($k = 4; $k < 7; $k++) { $d = date('Y-m-d', strtotime("$last +$k days")); if ((int) date('w', strtotime($d)) === (int) ($s['checkin_weekday'] ?? 1)) return $d; }
    return $next;
}

/**
 * Work out and send whatever is due for one user. Returns the reminder keys sent.
 * Each check runs only when its time has come, so a slow query never runs every tick.
 */
function run_reminders_for(int $uid, int $now): array {
    $s = get_settings($uid);
    $r = clean_reminders($s['reminders'] ?? []);
    $date = date('Y-m-d', $now);
    $sent = [];
    $send = function (string $key, array $msg) use ($uid, $date, &$sent) {
        reminder_mark($uid, $key, $date); // mark first so a slow push service can't cause a repeat
        if (push_to_user($uid, $msg + ['tag' => $key])) $sent[] = $key;
    };
    $isDue = fn(string $key, string $time) => reminder_due_now($time, $now) && !reminder_sent($uid, $key, $date);

    if ($r['weigh_in']['on'] && $isDue('weigh_in', $r['weigh_in']['time'])) {
        if (q_one('SELECT id FROM weights WHERE user_id = ? AND date = ?', [$uid, $date])) reminder_mark($uid, 'weigh_in', $date);
        else $send('weigh_in', ['title' => 'Weigh in', 'body' => 'Step on the scale before breakfast to keep your trend accurate.', 'url' => '#/weight']);
    }

    if ($r['food']['on'] && $isDue('food', $r['food']['time'])) {
        $meals = (int) q_val('SELECT COUNT(DISTINCT meal) FROM diary_entries WHERE user_id = ? AND date = ?', [$uid, $date]);
        $status = q_val('SELECT status FROM days WHERE user_id = ? AND date = ?', [$uid, $date]);
        if ($meals >= $r['food']['min_meals'] || in_array($status, ['fasted', 'exclude', 'complete'], true)) reminder_mark($uid, 'food', $date);
        else $send('food', ['title' => 'Finish logging today', 'body' => $meals ? "Only $meals meal" . ($meals === 1 ? '' : 's') . ' logged so far. Add the rest while you remember.' : 'Nothing logged yet today.', 'url' => '#/food/diary']);
    }

    if ($r['meds']['on']) {
        foreach (health_items_for($uid, $date) as $item) {
            if (!$item['remind']) continue;
            foreach ($item['doses'] as $d) {
                $key = "med:{$item['id']}:{$d['slot']}";
                if (!$isDue($key, $d['time'])) continue;
                if ($d['taken_at']) { reminder_mark($uid, $key, $date); continue; }
                $n = count($item['doses']);
                $send($key, ['title' => $item['name'] . ($item['dose'] ? ", {$item['dose']}" : ''),
                    'body' => ($n > 1 ? 'Dose ' . ($d['slot'] + 1) . " of $n. " : '') . 'Tap to mark it taken.', 'url' => '#/health/meds']);
            }
            // Refill: once when a week of supply is left, then every 3 days until it's topped up.
            if ($item['refill_remind'] && $item['supply_days'] !== null && $item['supply_days'] <= 7 && reminder_due_now('09:00', $now)) {
                $key = "refill:{$item['id']}";
                $recent = q_val('SELECT MAX(date) FROM reminder_log WHERE user_id = ? AND rkey = ?', [$uid, $key]);
                if (!$recent || $recent <= date('Y-m-d', strtotime("$date -3 days"))) {
                    $send($key, ['title' => 'Refill ' . $item['name'], 'body' => "About {$item['supply_days']} day" . ($item['supply_days'] === 1 ? '' : 's') . ' of supply left.', 'url' => '#/health/meds']);
                }
            }
        }
    }

    $weekday = (int) date('w', $now);
    if ($r['photos']['on'] && $weekday === $r['photos']['weekday'] && $isDue('photos', $r['photos']['time'])) {
        if (q_one('SELECT id FROM progress_photos WHERE user_id = ? AND date = ?', [$uid, $date])) reminder_mark($uid, 'photos', $date);
        else $send('photos', ['title' => 'Progress photos', 'body' => 'Front, side and back. Same spot and light as last time.', 'url' => '#/body/photos']);
    }

    if ($r['report']['on'] && $weekday === $r['report']['weekday'] && $isDue('report', $r['report']['time'])) {
        $from = date('Y-m-d', strtotime("$date -6 days"));
        $logged = (int) q_val('SELECT COUNT(DISTINCT date) FROM diary_entries WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $date]);
        $lifts = (int) q_val('SELECT COUNT(*) FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $date]);
        $cardio = count(cardio_sessions($uid, $from, $date));
        $bits = ["$logged of 7 days logged"];
        if ($lifts) $bits[] = "$lifts lifting session" . ($lifts === 1 ? '' : 's');
        if ($cardio) $bits[] = "$cardio cardio";
        $send('report', ['title' => 'Your week is ready', 'body' => implode(', ', $bits) . '. Tap for the full report.', 'url' => '#/report']);
    }

    if ($r['checkin']['on'] && $isDue('checkin', $r['checkin']['time'])) {
        $next = checkin_next($uid, $s);
        if ($next !== null && $next <= $date) $send('checkin', ['title' => 'Check-in ready', 'body' => 'Your weekly check-in has new targets to review.', 'url' => '#/progress']);
        else reminder_mark($uid, 'checkin', $date);
    }
    return $sent;
}

function run_reminders(?int $now = null): array {
    $now ??= time();
    $out = [];
    foreach (q_all('SELECT DISTINCT user_id FROM push_subscriptions') as $row) {
        try { $out[$row['user_id']] = run_reminders_for((int) $row['user_id'], $now); }
        catch (Throwable $e) { $out[$row['user_id']] = ['error' => $e->getMessage()]; error_log('[farrell-fitness] reminders: ' . $e->getMessage()); }
    }
    q('DELETE FROM reminder_log WHERE date < ?', [date('Y-m-d', strtotime('-60 days', $now))]);
    return $out;
}

/**
 * Everything scheduled, in one cron job (every 15 minutes is plenty):
 * reminders each tick, WHOOP about hourly, and the nightly backup after 3 am.
 */
function run_tick(): array {
    $out = ['at' => date('c')];
    try { $out['reminders'] = run_reminders(); } catch (Throwable $e) { $out['reminders'] = ['error' => $e->getMessage()]; }
    $lastWhoop = (int) (db_meta_get('last_whoop_tick') ?? 0);
    if (time() - $lastWhoop >= 55 * 60) {
        db_meta_set('last_whoop_tick', (string) time());
        try { $out['whoop'] = run_whoop_cron(); } catch (Throwable $e) { $out['whoop'] = ['error' => $e->getMessage()]; }
    }
    try { $b = backup_if_due(); if ($b) $out['backup'] = $b['name']; } catch (Throwable $e) { $out['backup'] = ['error' => $e->getMessage()]; }
    db_meta_set('last_tick_at', (string) time());
    return $out;
}

function route_reminders_status(int $uid, string $m) {
    $last = (int) (db_meta_get('last_tick_at') ?? 0);
    return ['reminders' => clean_reminders(get_settings($uid)['reminders'] ?? []), 'last_tick_at' => $last ?: null,
        'scheduler_ok' => $last > time() - 3 * 3600,
        'devices' => (int) q_val('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?', [$uid])];
}

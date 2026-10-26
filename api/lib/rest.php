<?php
// Rest timer alarm for a locked phone. When a rest starts, the app asks for a push at the moment it
// ends, to the one device doing the workout. Push services can't deliver later on their own, so this
// request answers right away and then keeps running until the rest is over (or is cancelled or
// replaced), and sends the push itself. The cron tick sends any alarm that request didn't get to.

const REST_MAX_WAIT = 900;     // seconds; a rest longer than 15 minutes isn't scheduled
const REST_GRACE = 90;         // an alarm more than this late is dropped instead of sent

function route_rest_schedule(int $uid, string $m) {
    if ($m !== 'POST') fail(405, 'Use POST');
    $endpoint = (string) param('endpoint', '');
    $hash = hash('sha256', $endpoint);
    $sub = q_one('SELECT * FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?', [$hash, $uid]);
    if (!$sub) fail(400, 'Reminders are off on this device');
    $in = (int) param('in_seconds', 0);
    if ($in < 1 || $in > REST_MAX_WAIT) fail(400, 'Rest must be between 1 second and 15 minutes');
    $fire = time() + $in;
    $token = bin2hex(random_bytes(8));
    db_upsert('rest_alarms', ['endpoint_hash' => $hash], [
        'user_id' => $uid, 'fire_at' => $fire, 'token' => $token,
        'title' => mb_substr(trim((string) param('title', 'Rest over')), 0, 120) ?: 'Rest over',
        'body' => mb_substr(trim((string) param('body', '')), 0, 240),
        'url' => preg_match('~^#/[a-z0-9/_-]{0,60}$~', (string) param('url', '')) ? param('url') : '#/train/active',
        'created_at' => time(),
    ]);
    // The built-in PHP server handles one request at a time, so it can't wait here (local testing
    // and the tests); the cron tick covers it there.
    if (PHP_SAPI === 'cli-server' || param('no_wait', false)) return ['ok' => true, 'fire_at' => $fire, 'waiting' => false];
    respond_and_continue(['ok' => true, 'fire_at' => $fire, 'waiting' => true]);
    rest_wait_and_send($hash, $token);
    exit;
}

function route_rest_cancel(int $uid, string $m) {
    $hash = hash('sha256', (string) param('endpoint', ''));
    q('DELETE FROM rest_alarms WHERE endpoint_hash = ? AND user_id = ?', [$hash, $uid]);
    return ['ok' => true];
}

/** Sends the JSON answer and closes the connection, so the app isn't kept waiting. */
function respond_and_continue(array $out): void {
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close(); // don't hold the session lock while waiting
    ignore_user_abort(true);
    @set_time_limit(REST_MAX_WAIT + 120);
    $json = json_encode($out, JSON_UNESCAPED_SLASHES);
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('Connection: close');
    header('Content-Length: ' . strlen($json));
    echo $json;
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); return; }
    if (function_exists('litespeed_finish_request')) { litespeed_finish_request(); return; }
    while (ob_get_level() > 0) @ob_end_flush();
    flush();
}

/** Waits for one alarm, checking every couple of seconds that it hasn't been cancelled or moved. */
function rest_wait_and_send(string $hash, string $token): void {
    while (true) {
        $a = q_one('SELECT * FROM rest_alarms WHERE endpoint_hash = ?', [$hash]);
        if (!$a || $a['token'] !== $token) return;          // cancelled, or a newer rest replaced it
        $left = (int) $a['fire_at'] - time();
        if ($left <= 0) break;
        sleep(min(2, $left));
    }
    rest_send($a);
}

/** Sends one alarm and removes it. Only the device that scheduled it gets the push. */
function rest_send(array $a): bool {
    // Claim it first, so the cron tick and the waiting request can't both send it.
    $claimed = q('DELETE FROM rest_alarms WHERE id = ? AND token = ?', [$a['id'], $a['token']])->rowCount();
    if (!$claimed) return false;
    $sub = q_one('SELECT * FROM push_subscriptions WHERE endpoint_hash = ?', [$a['endpoint_hash']]);
    if (!$sub) return false;
    try {
        $s = webpush_send($sub, ['title' => $a['title'], 'body' => $a['body'], 'url' => $a['url'], 'tag' => 'rest', 'renotify' => true, 'vibrate' => [300, 150, 300]], 90);
        return $s >= 200 && $s < 300;
    } catch (Throwable $e) { error_log('[farrell-fitness] rest push: ' . $e->getMessage()); return false; }
}

/** From the cron tick: anything due that the waiting request missed, if it's still fresh. */
function run_rest_alarms(): array {
    $now = time();
    $sent = 0;
    foreach (q_all('SELECT * FROM rest_alarms WHERE fire_at <= ?', [$now]) as $a) {
        if ($now - (int) $a['fire_at'] > REST_GRACE) { q('DELETE FROM rest_alarms WHERE id = ?', [$a['id']]); continue; }
        if (rest_send($a)) $sent++;
    }
    return ['sent' => $sent];
}

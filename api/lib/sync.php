<?php
// Smart scale sync. Scales like Eufy write to Apple Health; an iPhone Shortcut reads the latest
// weight and body fat from Health and posts them here with a private key. The key is shown once
// when it's made and only its hash is stored.

function route_sync_status(int $uid, string $m) {
    $k = q_one('SELECT created_at, last_used_at, uses FROM sync_keys WHERE user_id = ? ORDER BY id DESC LIMIT 1', [$uid]);
    $lastScale = q_one("SELECT date, weight_kg, body_fat FROM weights WHERE user_id = ? AND source = 'scale' ORDER BY date DESC LIMIT 1", [$uid]);
    return ['has_key' => (bool) $k, 'created_at' => $k ? (int) $k['created_at'] : null, 'last_used_at' => $k && $k['last_used_at'] ? (int) $k['last_used_at'] : null,
        'uses' => $k ? (int) $k['uses'] : 0, 'endpoint' => base_url() . '/api/?r=sync/scale',
        'last' => $lastScale ? ['date' => $lastScale['date'], 'weight_kg' => (float) $lastScale['weight_kg'], 'body_fat' => $lastScale['body_fat'] === null ? null : (float) $lastScale['body_fat']] : null,
        'count' => (int) q_val("SELECT COUNT(*) FROM weights WHERE user_id = ? AND source = 'scale'", [$uid])];
}

/** Make a new key, replacing any old one. The plain key is returned only here. */
function route_sync_key(int $uid, string $m) {
    if ($m !== 'POST') fail(405, 'Use POST');
    $key = 'ffs_' . bin2hex(random_bytes(20));
    q('DELETE FROM sync_keys WHERE user_id = ?', [$uid]);
    db_insert('sync_keys', ['user_id' => $uid, 'key_hash' => hash('sha256', $key), 'created_at' => time(), 'uses' => 0]);
    return ['key' => $key] + route_sync_status($uid, 'GET');
}

function route_sync_revoke(int $uid, string $m) {
    q('DELETE FROM sync_keys WHERE user_id = ?', [$uid]);
    return route_sync_status($uid, 'GET');
}

/** Pull a number out of what Shortcuts sends: 195.8, "195.8", "195.8 lb", "19.1%". */
function loose_number($v): ?float {
    if (is_int($v) || is_float($v)) return (float) $v;
    if (!is_string($v)) return null;
    $v = str_replace(',', '.', trim($v));
    return preg_match('/-?\d+(\.\d+)?/', $v, $m) ? (float) $m[0] : null;
}

/** Shortcuts dates come in many shapes; anything strtotime understands works. Defaults to today. */
function loose_date($v): string {
    if (!is_string($v) || trim($v) === '') return today();
    $v = trim(str_replace([' at ', ' um '], ' ', $v));
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) return $v;
    $t = strtotime($v);
    if ($t === false) fail(400, "Couldn't read the date \"$v\". Use Format Date with ISO 8601 in the Shortcut.");
    return date('Y-m-d', $t);
}

/**
 * POST api/?r=sync/scale with header "Authorization: Bearer <key>" (or "key" in the body).
 * Body: {"weight": 195.8, "unit": "lb", "body_fat": 19.1, "date": "2026-10-25"}
 *   or {"samples": [{...}, {...}]} to send several days at once.
 * The newest reading for a day wins. A weight you typed in yourself for the same day is replaced.
 */
function route_sync_scale(): array {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') fail(405, 'Use POST');
    $ip = client_ip();
    q('DELETE FROM login_attempts WHERE ts < ?', [time() - 900]);
    if ((int) q_val('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$ip]) >= 8) fail(429, 'Too many attempts. Wait 15 minutes.');
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    $key = preg_match('/^Bearer\s+(\S+)$/i', $auth, $m) ? $m[1] : (string) param('key', '');
    $row = $key !== '' ? q_one('SELECT * FROM sync_keys WHERE key_hash = ?', [hash('sha256', $key)]) : null;
    if (!$row) { db_insert('login_attempts', ['ip' => $ip, 'ts' => time()]); fail(401, 'Unknown sync key. Make a new one in Settings > Reminders and sync.'); }
    $uid = (int) $row['user_id'];

    $samples = param('samples');
    $samples = is_array($samples) ? array_slice($samples, 0, 400) : [body() ?: $_GET];
    $saved = [];
    foreach ($samples as $s) {
        if (!is_array($s)) continue;
        $w = loose_number($s['weight'] ?? null);
        if ($w === null) continue;
        $unit = strtolower((string) ($s['unit'] ?? (is_string($s['weight'] ?? null) && stripos($s['weight'], 'kg') !== false ? 'kg' : 'lb')));
        $kg = str_starts_with($unit, 'kg') ? $w : $w / 2.20462;
        if ($kg < 25 || $kg > 350) fail(400, "That weight looks out of range: $w $unit");
        $bf = loose_number($s['body_fat'] ?? null);
        if ($bf !== null && $bf > 0 && $bf < 1) $bf *= 100; // Health stores body fat as a fraction
        if ($bf !== null && ($bf < 2 || $bf > 70)) $bf = null;
        $date = loose_date($s['date'] ?? null);
        if ($date > today()) continue;
        db_upsert('weights', ['user_id' => $uid, 'date' => $date], ['weight_kg' => round($kg, 3), 'body_fat' => $bf === null ? null : round($bf, 1), 'source' => 'scale']);
        $saved[$date] = ['date' => $date, 'weight_kg' => round($kg, 2), 'body_fat' => $bf];
    }
    if (!$saved) fail(400, 'No weight in the request. Send {"weight": 195.8, "unit": "lb"}.');
    q('UPDATE sync_keys SET last_used_at = ?, uses = uses + 1 WHERE id = ?', [time(), $row['id']]);
    $n = count($saved);
    $last = end($saved);
    $lb = (get_settings($uid)['units'] ?? 'imperial') === 'imperial';
    return ['ok' => true, 'saved' => $n, 'message' => $n === 1
        ? sprintf('Saved %.1f %s for %s', $lb ? $last['weight_kg'] * 2.20462 : $last['weight_kg'], $lb ? 'lb' : 'kg', $last['date'])
        : "Saved $n weigh-ins"];
}

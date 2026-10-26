<?php
// WHOOP Developer API v2: OAuth connect, token refresh, and syncing cycles,
// recovery, sleep and workouts into whoop_daily / whoop_workouts.

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API = 'https://api.prod.whoop.com/developer';
const WHOOP_SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';

function whoop_cfg(): array {
    $c = config()['whoop'] ?? [];
    if (empty($c['client_id']) || empty($c['client_secret'])) {
        fail(400, 'WHOOP is not configured yet. Add your WHOOP client ID and secret to api/config.php.');
    }
    return $c;
}

function whoop_redirect_uri(): string { return base_url() . '/api/?r=whoop/callback'; }

function whoop_authorize_url(): string {
    $c = whoop_cfg();
    start_session();
    $state = bin2hex(random_bytes(16));
    $_SESSION['whoop_state'] = $state;
    return WHOOP_AUTH_URL . '?' . http_build_query([
        'response_type' => 'code',
        'client_id' => $c['client_id'],
        'redirect_uri' => whoop_redirect_uri(),
        'scope' => WHOOP_SCOPES,
        'state' => $state,
    ]);
}

function whoop_token_request(array $fields): array {
    $c = whoop_cfg();
    $fields += ['client_id' => $c['client_id'], 'client_secret' => $c['client_secret']];
    [$status, $res] = http_request('POST', WHOOP_TOKEN_URL,
        ['Content-Type' => 'application/x-www-form-urlencoded'], http_build_query($fields));
    if ($status >= 400 || !is_array($res) || empty($res['access_token'])) {
        $msg = is_array($res) ? ($res['error_description'] ?? $res['error'] ?? 'unknown error') : 'unknown error';
        fail(502, "WHOOP sign-in failed: $msg");
    }
    return $res;
}

function whoop_store_tokens(int $uid, array $t): void {
    $data = [
        'access_token' => $t['access_token'],
        'expires_at' => time() + (int) ($t['expires_in'] ?? 3600) - 60,
    ];
    if (!empty($t['refresh_token'])) $data['refresh_token'] = $t['refresh_token'];
    db_upsert('whoop_tokens', ['user_id' => $uid], $data);
}

function whoop_handle_callback(int $uid, string $code, string $state): void {
    start_session();
    $expected = $_SESSION['whoop_state'] ?? '';
    unset($_SESSION['whoop_state']);
    if ($expected === '' || !hash_equals($expected, $state)) fail(400, 'WHOOP sign-in expired. Try connecting again.');
    $t = whoop_token_request([
        'grant_type' => 'authorization_code',
        'code' => $code,
        'redirect_uri' => whoop_redirect_uri(),
    ]);
    whoop_store_tokens($uid, $t);
    try {
        $p = whoop_get($uid, '/v2/user/profile/basic');
        db_update('whoop_tokens', ['whoop_user_id' => (string) ($p['user_id'] ?? '')], ['user_id' => $uid]);
    } catch (Throwable $e) { /* profile is optional */ }
}

function whoop_access_token(int $uid): string {
    $row = q_one('SELECT * FROM whoop_tokens WHERE user_id = ?', [$uid]);
    if (!$row) fail(400, 'WHOOP is not connected');
    if ($row['expires_at'] > time()) return $row['access_token'];
    if (empty($row['refresh_token'])) fail(401, 'WHOOP access expired. Reconnect WHOOP in Settings.');
    $t = whoop_token_request([
        'grant_type' => 'refresh_token',
        'refresh_token' => $row['refresh_token'],
        'scope' => 'offline',
    ]);
    whoop_store_tokens($uid, $t);
    return $t['access_token'];
}

function whoop_get(int $uid, string $path, array $query = []): array {
    $url = WHOOP_API . $path . ($query ? '?' . http_build_query($query) : '');
    for ($attempt = 0; $attempt < 3; $attempt++) {
        [$status, $res] = http_request('GET', $url, ['Authorization' => 'Bearer ' . whoop_access_token($uid)]);
        if ($status === 429) { sleep(2 + $attempt * 3); continue; }
        if ($status === 401 && $attempt === 0) { q('UPDATE whoop_tokens SET expires_at = 0 WHERE user_id = ?', [$uid]); continue; }
        if ($status >= 400 || !is_array($res)) fail(502, "WHOOP request failed ($status)");
        return $res;
    }
    fail(429, 'WHOOP is rate-limiting requests. Try again in a minute.');
}

function whoop_collection(int $uid, string $path, string $start, string $end): array {
    $out = [];
    $next = null;
    for ($page = 0; $page < 40; $page++) {
        $q = ['limit' => 25, 'start' => $start, 'end' => $end];
        if ($next) $q['nextToken'] = $next;
        $res = whoop_get($uid, $path, $q);
        $out = array_merge($out, $res['records'] ?? []);
        $next = $res['next_token'] ?? ($res['nextToken'] ?? null);
        if (!$next) break;
    }
    return $out;
}

/** Local calendar date for a WHOOP timestamp, using the record's own timezone offset. */
function whoop_local_date(string $iso, ?string $offset): string {
    $dt = new DateTime($iso);
    if ($offset && preg_match('/^[+-]\d{2}:\d{2}$/', $offset)) {
        $dt->setTimezone(new DateTimeZone($offset));
    } else {
        $dt->setTimezone(new DateTimeZone(config()['timezone'] ?? 'UTC'));
    }
    return $dt->format('Y-m-d');
}

/** Heart rate zone durations as JSON seconds [zone0..zone5], or null. */
function whoop_zones($z): ?string {
    if (!is_array($z)) return null;
    $names = ['zero', 'one', 'two', 'three', 'four', 'five'];
    $out = array_map(fn($n) => isset($z["zone_{$n}_milli"]) ? (int) round($z["zone_{$n}_milli"] / 1000) : 0, $names);
    return array_sum($out) ? json_encode($out) : null;
}

function ms_to_h($ms): ?float { return $ms === null ? null : round($ms / 3600000, 2); }

function whoop_sync(int $uid, ?int $days = null): array {
    $row = q_one('SELECT * FROM whoop_tokens WHERE user_id = ?', [$uid]);
    if (!$row) fail(400, 'WHOOP is not connected');
    if ($days === null) {
        // First sync pulls 90 days; later syncs re-read the last 4 days so late scores land.
        $days = $row['last_sync_at'] ? max(4, (int) ceil((time() - $row['last_sync_at']) / 86400) + 3) : 90;
    }
    $days = min($days, 365);
    $start = gmdate('Y-m-d\TH:i:s.000\Z', time() - $days * 86400);
    $end = gmdate('Y-m-d\TH:i:s.000\Z', time() + 3600);

    $daily = [];
    $cycleDate = [];

    foreach (whoop_collection($uid, '/v2/cycle', $start, $end) as $c) {
        $d = whoop_local_date($c['start'], $c['timezone_offset'] ?? null);
        $cycleDate[(string) $c['id']] = $d;
        $s = ($c['score_state'] ?? '') === 'SCORED' ? ($c['score'] ?? []) : [];
        $daily[$d] = ($daily[$d] ?? []) + [
            'cycle_id' => (string) $c['id'],
            'strain' => isset($s['strain']) ? round($s['strain'], 1) : null,
            'kcal' => isset($s['kilojoule']) ? round($s['kilojoule'] / 4.184) : null,
            'avg_hr' => $s['average_heart_rate'] ?? null,
            'max_hr' => $s['max_heart_rate'] ?? null,
            // Added to the API in September 2026; null when the strap wasn't worn.
            'step_count' => isset($c['step_count']) ? (int) $c['step_count'] : (isset($s['step_count']) ? (int) $s['step_count'] : null),
        ];
    }

    foreach (whoop_collection($uid, '/v2/recovery', $start, $end) as $r) {
        $d = $cycleDate[(string) ($r['cycle_id'] ?? '')] ?? whoop_local_date($r['created_at'], null);
        if (($r['score_state'] ?? '') !== 'SCORED') continue;
        $s = $r['score'] ?? [];
        $daily[$d] = array_merge($daily[$d] ?? [], [
            'recovery' => isset($s['recovery_score']) ? (int) round($s['recovery_score']) : null,
            'hrv' => isset($s['hrv_rmssd_milli']) ? round($s['hrv_rmssd_milli'], 1) : null,
            'rhr' => isset($s['resting_heart_rate']) ? (int) round($s['resting_heart_rate']) : null,
            'spo2' => isset($s['spo2_percentage']) ? round($s['spo2_percentage'], 1) : null,
            'skin_temp' => isset($s['skin_temp_celsius']) ? round($s['skin_temp_celsius'], 2) : null,
        ]);
    }

    foreach (whoop_collection($uid, '/v2/activity/sleep', $start, $end) as $sl) {
        if (!empty($sl['nap']) || ($sl['score_state'] ?? '') !== 'SCORED') continue;
        $d = whoop_local_date($sl['end'] ?? $sl['start'], $sl['timezone_offset'] ?? null);
        $s = $sl['score'] ?? [];
        $st = $s['stage_summary'] ?? [];
        $need = $s['sleep_needed'] ?? [];
        $light = $st['total_light_sleep_time_milli'] ?? null;
        $deep = $st['total_slow_wave_sleep_time_milli'] ?? null;
        $rem = $st['total_rem_sleep_time_milli'] ?? null;
        $asleep = ($light ?? 0) + ($deep ?? 0) + ($rem ?? 0);
        $needMs = ($need['baseline_milli'] ?? 0) + ($need['need_from_sleep_debt_milli'] ?? 0)
            + ($need['need_from_recent_strain_milli'] ?? 0) + ($need['need_from_recent_nap_milli'] ?? 0);
        $daily[$d] = array_merge($daily[$d] ?? [], [
            'sleep_perf' => isset($s['sleep_performance_percentage']) ? (int) round($s['sleep_performance_percentage']) : null,
            'sleep_eff' => isset($s['sleep_efficiency_percentage']) ? round($s['sleep_efficiency_percentage'], 1) : null,
            'sleep_consistency' => isset($s['sleep_consistency_percentage']) ? (int) round($s['sleep_consistency_percentage']) : null,
            'sleep_hours' => $asleep ? ms_to_h($asleep) : null,
            'sleep_need_hours' => $needMs ? ms_to_h($needMs) : null,
            'sleep_light' => ms_to_h($light), 'sleep_deep' => ms_to_h($deep), 'sleep_rem' => ms_to_h($rem),
            'resp_rate' => isset($s['respiratory_rate']) ? round($s['respiratory_rate'], 1) : null,
        ]);
    }

    $workouts = 0;
    foreach (whoop_collection($uid, '/v2/activity/workout', $start, $end) as $w) {
        $s = ($w['score_state'] ?? '') === 'SCORED' ? ($w['score'] ?? []) : [];
        db_upsert('whoop_workouts', ['user_id' => $uid, 'whoop_id' => (string) $w['id']], [
            'date' => whoop_local_date($w['start'], $w['timezone_offset'] ?? null),
            'sport' => isset($w['sport_name']) ? ucwords(str_replace(['_', '-'], ' ', $w['sport_name'])) : 'Activity',
            'start_at' => $w['start'], 'end_at' => $w['end'] ?? null,
            'strain' => isset($s['strain']) ? round($s['strain'], 1) : null,
            'kcal' => isset($s['kilojoule']) ? round($s['kilojoule'] / 4.184) : null,
            'avg_hr' => $s['average_heart_rate'] ?? null, 'max_hr' => $s['max_heart_rate'] ?? null,
            'distance_m' => isset($s['distance_meter']) ? round($s['distance_meter'], 1) : null,
            'altitude_gain_m' => isset($s['altitude_gain_meter']) ? round($s['altitude_gain_meter'], 1) : null,
            'percent_recorded' => isset($s['percent_recorded']) ? round($s['percent_recorded'], 1) : null,
            'zones' => whoop_zones($s['zone_durations'] ?? null),
        ]);
        $workouts++;
    }

    foreach ($daily as $d => $vals) {
        // Don't overwrite stored values with nulls from a not-yet-scored record.
        $vals = array_filter($vals, fn($v) => $v !== null);
        if ($vals) db_upsert('whoop_daily', ['user_id' => $uid, 'date' => $d], $vals);
    }
    db_update('whoop_tokens', ['last_sync_at' => time()], ['user_id' => $uid]);
    return ['days' => count($daily), 'workouts' => $workouts, 'synced_at' => time()];
}

function whoop_status(int $uid): array {
    $row = q_one('SELECT whoop_user_id, last_sync_at FROM whoop_tokens WHERE user_id = ?', [$uid]);
    $c = config()['whoop'] ?? [];
    return [
        'configured' => !empty($c['client_id']) && !empty($c['client_secret']),
        'connected' => (bool) $row,
        'last_sync_at' => $row ? ($row['last_sync_at'] ? (int) $row['last_sync_at'] : null) : null,
        'redirect_uri' => whoop_redirect_uri(),
    ];
}

/** Sync every connected account (cron). */
function run_whoop_cron(): array {
    $out = [];
    foreach (q_all('SELECT t.user_id FROM whoop_tokens t JOIN users u ON u.id = t.user_id WHERE u.disabled = 0') as $r) {
        try { $out[$r['user_id']] = whoop_sync((int) $r['user_id']); }
        catch (Throwable $e) { $out[$r['user_id']] = ['error' => $e->getMessage()]; }
    }
    return ['synced' => $out];
}

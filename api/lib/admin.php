<?php
// More than one person can use the app. Admins add people, reset passwords, pause and delete accounts.
// Everyone's data stays separate: admins see names and activity here, never anyone else's logs.

const TEMP_WORDS = ['maple', 'otter', 'cedar', 'harbor', 'falcon', 'river', 'summit', 'meadow', 'copper', 'willow', 'canyon', 'ember',
    'glacier', 'pepper', 'birch', 'comet', 'lantern', 'orchid', 'pebble', 'quartz', 'raven', 'saffron', 'thistle', 'walnut'];

function temp_password(): string {
    $w = TEMP_WORDS;
    return $w[random_int(0, count($w) - 1)] . '-' . $w[random_int(0, count($w) - 1)] . '-' . random_int(1000, 9999);
}

function require_admin(int $uid): void {
    if (!(int) q_val('SELECT is_admin FROM users WHERE id = ?', [$uid])) fail(403, 'Only admins can manage users');
}

function user_out(array $r, int $me): array {
    return [
        'id' => (int) $r['id'], 'username' => $r['username'], 'name' => $r['display_name'] ?: ucfirst($r['username']),
        'is_admin' => (bool) $r['is_admin'], 'disabled' => (bool) $r['disabled'], 'must_change_pw' => (bool) $r['must_change_pw'],
        'last_seen_at' => $r['last_seen_at'] === null ? null : (int) $r['last_seen_at'], 'created_at' => (int) $r['created_at'],
        'me' => (int) $r['id'] === $me,
    ];
}

function clean_username($v): string {
    $u = strtolower(trim((string) $v));
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,31}$/', $u)) fail(400, 'Usernames are 3 to 32 letters, numbers, dots, dashes or underscores');
    return $u;
}

function admin_target(int $uid): array {
    $row = q_one('SELECT * FROM users WHERE id = ?', [(int) req_num('id')]);
    if (!$row) fail(404, 'User not found');
    return $row;
}

function admin_count(): int { return (int) q_val('SELECT COUNT(*) FROM users WHERE is_admin = 1 AND disabled = 0'); }

function route_admin_users(int $uid, string $m) {
    require_admin($uid);
    return ['users' => array_map(fn($r) => user_out($r, $uid), q_all('SELECT * FROM users ORDER BY is_admin DESC, created_at, id'))];
}

function route_admin_users_create(int $uid, string $m) {
    require_admin($uid);
    $username = clean_username(param('username'));
    if (q_val('SELECT id FROM users WHERE LOWER(username) = ?', [$username])) fail(400, 'That username is taken');
    $name = mb_substr(trim((string) param('name', '')), 0, 80) ?: null;
    $pw = temp_password();
    $settings = ['units' => get_settings($uid)['units']];
    $id = db_insert('users', [
        'username' => $username, 'password_hash' => password_hash($pw, PASSWORD_DEFAULT), 'settings' => json_encode($settings),
        'created_at' => time(), 'display_name' => $name, 'is_admin' => param('is_admin') ? 1 : 0, 'disabled' => 0, 'must_change_pw' => 1,
    ]);
    if (param('seed', true)) seed_exercises($id);
    return ['user' => user_out(q_one('SELECT * FROM users WHERE id = ?', [$id]), $uid), 'temp_password' => $pw] + route_admin_users($uid, $m);
}

function route_admin_users_update(int $uid, string $m) {
    require_admin($uid);
    $row = admin_target($uid);
    $self = (int) $row['id'] === $uid;
    $data = [];
    if (param('name') !== null) $data['display_name'] = mb_substr(trim((string) param('name')), 0, 80) ?: null;
    if (param('is_admin') !== null) {
        $v = param('is_admin') ? 1 : 0;
        if (!$v && $row['is_admin'] && admin_count() <= 1) fail(400, 'Keep at least one admin');
        if (!$v && $self) fail(400, "You can't remove your own admin access. Ask another admin.");
        $data['is_admin'] = $v;
    }
    if (param('disabled') !== null) {
        $v = param('disabled') ? 1 : 0;
        if ($v && $self) fail(400, "You can't pause your own account");
        if ($v && $row['is_admin'] && admin_count() <= 1) fail(400, 'Keep at least one admin');
        $data['disabled'] = $v;
        if ($v) end_sessions((int) $row['id']);
    }
    if ($data) db_update('users', $data, ['id' => $row['id']]);
    return route_admin_users($uid, $m);
}

function route_admin_users_reset(int $uid, string $m) {
    require_admin($uid);
    $row = admin_target($uid);
    if ((int) $row['id'] === $uid) fail(400, 'Change your own password in Settings');
    $pw = temp_password();
    db_update('users', ['password_hash' => password_hash($pw, PASSWORD_DEFAULT), 'must_change_pw' => 1], ['id' => $row['id']]);
    end_sessions((int) $row['id']);
    return ['temp_password' => $pw] + route_admin_users($uid, $m);
}

function route_admin_users_signout(int $uid, string $m) {
    require_admin($uid);
    $row = admin_target($uid);
    end_sessions((int) $row['id']);
    return route_admin_users($uid, $m);
}

/** Every table with a user_id column. workout_sets hang off workouts and go with them. */
const USER_TABLES = ['auth_tokens', 'foods', 'diary_entries', 'days', 'weights', 'exercises', 'routines', 'checkins', 'whoop_tokens', 'whoop_daily',
    'whoop_workouts', 'meal_plans', 'cardio', 'health_items', 'health_doses', 'labs', 'glucose', 'measurements', 'habits', 'habit_logs', 'journal',
    'med_doses', 'progress_photos', 'push_subscriptions', 'reminder_log', 'sync_keys', 'drinks', 'rest_alarms',
    'stretches', 'stretch_routines', 'stretch_sessions', 'workout_schedule'];

function delete_user_data(int $id): void {
    q('DELETE FROM workout_sets WHERE workout_id IN (SELECT id FROM workouts WHERE user_id = ?)', [$id]);
    q('DELETE FROM workouts WHERE user_id = ?', [$id]);
    foreach (USER_TABLES as $t) q("DELETE FROM $t WHERE user_id = ?", [$id]);
    $dir = rtrim(config()['data_dir'] ?? (__DIR__ . '/../../data'), '/') . "/photos/u$id";
    if (is_dir($dir)) {
        foreach (glob($dir . '/*') ?: [] as $f) @unlink($f);
        @rmdir($dir);
    }
    q('DELETE FROM users WHERE id = ?', [$id]);
}

function route_admin_users_delete(int $uid, string $m) {
    require_admin($uid);
    $row = admin_target($uid);
    if ((int) $row['id'] === $uid) fail(400, "You can't delete your own account here");
    if ($row['is_admin'] && admin_count() <= 1) fail(400, 'Keep at least one admin');
    if (strtolower(trim((string) param('confirm', ''))) !== strtolower($row['username'])) fail(400, 'Type their username to confirm');
    delete_user_data((int) $row['id']);
    return route_admin_users($uid, $m);
}

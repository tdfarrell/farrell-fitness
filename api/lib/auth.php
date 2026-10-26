<?php
// Login, sessions and the long-lived "stay signed in" cookie used by the installed app.

const REMEMBER_COOKIE = 'ff_remember';
const REMEMBER_DAYS = 180;

function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function cookie_path(): string {
    $p = parse_url(base_url(), PHP_URL_PATH) ?: '/';
    return rtrim($p, '/') . '/';
}

function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('ff_sess');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => cookie_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function set_remember_cookie(string $value, int $expires): void {
    setcookie(REMEMBER_COOKIE, $value, [
        'expires' => $expires,
        'path' => cookie_path(),
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function issue_remember_token(int $userId): void {
    $selector = bin2hex(random_bytes(12));
    $validator = bin2hex(random_bytes(32));
    $expires = time() + REMEMBER_DAYS * 86400;
    db_insert('auth_tokens', [
        'user_id' => $userId,
        'selector' => $selector,
        'validator_hash' => hash('sha256', $validator),
        'expires_at' => $expires,
    ]);
    set_remember_cookie("$selector:$validator", $expires);
}

/** Signs a user out on every device: remember tokens go, and open sessions stop matching their epoch. */
function end_sessions(int $userId): void {
    q('DELETE FROM auth_tokens WHERE user_id = ?', [$userId]);
    q('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?', [$userId]);
}

/** The signed-in user's row, if the account still exists, isn't paused and the session is current. */
function session_user(int $uid): ?array {
    $u = q_one('SELECT id, username, display_name, is_admin, disabled, must_change_pw, session_epoch, last_seen_at FROM users WHERE id = ?', [$uid]);
    if (!$u || $u['disabled']) return null;
    return $u;
}

function begin_session(array $user): void {
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    $_SESSION['epoch'] = (int) ($user['session_epoch'] ?? 0);
}

function current_user_id(): ?int {
    static $cached = false;
    if ($cached !== false) return $cached;
    return $cached = resolve_user_id();
}

function resolve_user_id(): ?int {
    start_session();
    if (!empty($_SESSION['uid'])) {
        $u = session_user((int) $_SESSION['uid']);
        if ($u && (int) $u['session_epoch'] === (int) ($_SESSION['epoch'] ?? 0)) {
            touch_last_seen($u);
            return (int) $u['id'];
        }
        $_SESSION = [];
    }

    $c = $_COOKIE[REMEMBER_COOKIE] ?? '';
    if (!preg_match('/^([a-f0-9]{24}):([a-f0-9]{64})$/', $c, $m)) return null;
    $row = q_one('SELECT * FROM auth_tokens WHERE selector = ?', [$m[1]]);
    if (!$row || $row['expires_at'] < time() || !hash_equals($row['validator_hash'], hash('sha256', $m[2]))) {
        if ($row) q('DELETE FROM auth_tokens WHERE id = ?', [$row['id']]);
        set_remember_cookie('', time() - 3600);
        return null;
    }
    $u = session_user((int) $row['user_id']);
    q('DELETE FROM auth_tokens WHERE id = ?', [$row['id']]);
    if (!$u) { set_remember_cookie('', time() - 3600); return null; }
    // Rotate the token on use so a stolen cookie has a short shelf life.
    issue_remember_token((int) $u['id']);
    begin_session($u);
    touch_last_seen($u);
    return (int) $u['id'];
}

function touch_last_seen(array $u): void {
    if ((int) ($u['last_seen_at'] ?? 0) < time() - 300) q('UPDATE users SET last_seen_at = ? WHERE id = ?', [time(), $u['id']]);
}

function require_user(): int {
    $uid = current_user_id();
    if (!$uid) fail(401, 'Sign in to continue');
    return $uid;
}

/** State-changing requests must carry a custom header, which cross-site forms cannot send. */
function require_csrf_header(): void {
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($m !== 'GET' && ($_SERVER['HTTP_X_FF_REQUEST'] ?? '') !== '1') fail(403, 'Missing request header');
}

function login(string $username, string $password, bool $remember): array {
    $ip = client_ip();
    q('DELETE FROM login_attempts WHERE ts < ?', [time() - 900]);
    $recent = (int) q_val('SELECT COUNT(*) FROM login_attempts WHERE ip = ?', [$ip]);
    if ($recent >= 8) fail(429, 'Too many failed sign-ins. Wait 15 minutes and try again.');

    $user = q_one('SELECT * FROM users WHERE LOWER(username) = ?', [strtolower(trim($username))]);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        db_insert('login_attempts', ['ip' => $ip, 'ts' => time()]);
        fail(401, 'Username or password is incorrect');
    }
    if ($user['disabled']) fail(403, 'This account is paused. Ask an admin to turn it back on.');
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        db_update('users', ['password_hash' => password_hash($password, PASSWORD_DEFAULT)], ['id' => $user['id']]);
    }
    q('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
    begin_session($user);
    if ($remember) issue_remember_token((int) $user['id']);
    touch_last_seen($user);
    return auth_user_out($user);
}

/** What the app gets about the signed-in user. */
function auth_user_out(array $u): array {
    return ['id' => (int) $u['id'], 'username' => $u['username'], 'name' => $u['display_name'] ?: ucfirst($u['username']),
        'is_admin' => (bool) $u['is_admin'], 'must_change_pw' => (bool) $u['must_change_pw']];
}

function logout(): void {
    start_session();
    $c = $_COOKIE[REMEMBER_COOKIE] ?? '';
    if (preg_match('/^([a-f0-9]{24}):/', $c, $m)) q('DELETE FROM auth_tokens WHERE selector = ?', [$m[1]]);
    set_remember_cookie('', time() - 3600);
    $_SESSION = [];
    session_destroy();
}

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

function current_user_id(): ?int {
    start_session();
    if (!empty($_SESSION['uid'])) return (int) $_SESSION['uid'];

    $c = $_COOKIE[REMEMBER_COOKIE] ?? '';
    if (!preg_match('/^([a-f0-9]{24}):([a-f0-9]{64})$/', $c, $m)) return null;
    $row = q_one('SELECT * FROM auth_tokens WHERE selector = ?', [$m[1]]);
    if (!$row || $row['expires_at'] < time() || !hash_equals($row['validator_hash'], hash('sha256', $m[2]))) {
        if ($row) q('DELETE FROM auth_tokens WHERE id = ?', [$row['id']]);
        set_remember_cookie('', time() - 3600);
        return null;
    }
    // Rotate the token on use so a stolen cookie has a short shelf life.
    q('DELETE FROM auth_tokens WHERE id = ?', [$row['id']]);
    issue_remember_token((int) $row['user_id']);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $row['user_id'];
    return (int) $row['user_id'];
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

    $user = q_one('SELECT * FROM users WHERE username = ?', [$username]);
    if (!$user || !password_verify($password, $user['password_hash'])) {
        db_insert('login_attempts', ['ip' => $ip, 'ts' => time()]);
        fail(401, 'Username or password is incorrect');
    }
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        db_update('users', ['password_hash' => password_hash($password, PASSWORD_DEFAULT)], ['id' => $user['id']]);
    }
    q('DELETE FROM login_attempts WHERE ip = ?', [$ip]);
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = (int) $user['id'];
    if ($remember) issue_remember_token((int) $user['id']);
    return ['id' => (int) $user['id'], 'username' => $user['username']];
}

function logout(): void {
    start_session();
    $c = $_COOKIE[REMEMBER_COOKIE] ?? '';
    if (preg_match('/^([a-f0-9]{24}):/', $c, $m)) q('DELETE FROM auth_tokens WHERE selector = ?', [$m[1]]);
    set_remember_cookie('', time() - 3600);
    $_SESSION = [];
    session_destroy();
}

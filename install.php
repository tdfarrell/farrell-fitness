<?php
// One-time setup: writes api/config.php, creates the tables and your account.
// It locks itself once an account exists.
declare(strict_types=1);
require __DIR__ . '/api/lib/db.php';
require __DIR__ . '/api/lib/seed.php';

$configPath = __DIR__ . '/api/config.php';
$hasConfig = file_exists($configPath);
$errors = [];
$done = false;

function h($s): string { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }

session_start();
if (empty($_SESSION['install_nonce'])) $_SESSION['install_nonce'] = bin2hex(random_bytes(16));

if ($hasConfig) {
    try {
        $cfg = require $configPath;
        $pdo = db_connect($cfg['db']);
        run_schema($pdo, $cfg['db']['driver']);
        if ((int) $pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
            http_response_code(403);
            echo '<!doctype html><meta charset="utf-8"><title>Already set up</title><body style="font-family:system-ui;padding:40px;max-width:560px">'
               . '<h1>Already set up</h1><p>Farrell Fitness is installed. You can delete <code>install.php</code> from the server.</p><p><a href="./">Open the app</a></p>';
            exit;
        }
    } catch (Throwable $e) {
        $errors[] = 'api/config.php exists but the database connection failed: ' . $e->getMessage();
    }
}

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$guessBase = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = fn($k, $d = '') => trim((string) ($_POST[$k] ?? $d));
    if (!hash_equals($_SESSION['install_nonce'], $in('nonce'))) $errors[] = 'Form expired. Reload the page.';
    $username = $in('username');
    $password = (string) ($_POST['password'] ?? '');
    if (!preg_match('/^[A-Za-z0-9_.@-]{3,80}$/', $username)) $errors[] = 'Username must be 3 to 80 letters, numbers or . _ @ -';
    if (strlen($password) < 10) $errors[] = 'Password must be at least 10 characters.';

    if (!$errors) {
        try {
            if ($hasConfig) {
                $cfg = require $configPath;
            } else {
                $cfg = [
                    'db' => [
                        'driver' => $in('driver', 'mysql') === 'sqlite' ? 'sqlite' : 'mysql',
                        'host' => $in('db_host', 'localhost'), 'name' => $in('db_name'),
                        'user' => $in('db_user'), 'pass' => (string) ($_POST['db_pass'] ?? ''),
                        'sqlite_path' => __DIR__ . '/data/app.sqlite',
                    ],
                    'base_url' => rtrim($in('base_url', $guessBase), '/'),
                    'timezone' => in_array($in('timezone'), timezone_identifiers_list(), true) ? $in('timezone') : 'America/New_York',
                    'usda_api_key' => $in('usda_api_key') ?: 'DEMO_KEY',
                    'whoop' => ['client_id' => $in('whoop_client_id'), 'client_secret' => $in('whoop_client_secret')],
                    'cron_secret' => bin2hex(random_bytes(24)),
                ];
            }
            $pdo = db_connect($cfg['db']);
            run_schema($pdo, $cfg['db']['driver']);
            if (!$hasConfig) {
                $php = "<?php\n// Written by install.php on " . date('c') . ". Keep this file private.\nreturn " . var_export($cfg, true) . ";\n";
                if (file_put_contents($configPath, $php) === false) throw new RuntimeException('Could not write api/config.php. Check folder permissions.');
                @chmod($configPath, 0600);
            }
            // db() / config() helpers read config.php, which now exists.
            $st = $pdo->prepare('INSERT INTO users (username, password_hash, settings, created_at) VALUES (?, ?, ?, ?)');
            $st->execute([$username, password_hash($password, PASSWORD_DEFAULT), json_encode(['units' => $in('units', 'imperial') === 'metric' ? 'metric' : 'imperial']), time()]);
            $uid = (int) $pdo->lastInsertId();
            seed_exercises($uid);
            $done = $cfg;
        } catch (Throwable $e) {
            $errors[] = $e->getMessage();
        }
    }
}
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up Farrell Fitness</title>
<style>
  :root { --ground:#E9EDF1; --surface:#fff; --ink:#16202B; --muted:#4E5B69; --line:#C9D2DC; --blue:#00275B; --red:#C9302C; }
  body { margin:0; background:var(--ground); color:var(--ink); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:620px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:34px; margin:0 0 4px; }
  section { background:var(--surface); border-radius:16px; padding:20px; margin:16px 0; }
  h2 { font-size:18px; margin:0 0 12px; }
  label { display:block; font-weight:600; font-size:14px; margin:12px 0 4px; }
  input, select { width:100%; box-sizing:border-box; height:44px; border:1px solid var(--line); border-radius:10px; padding:0 12px; font:inherit; background:#fff; }
  .hint { color:var(--muted); font-size:14px; margin:4px 0 0; }
  button { height:50px; padding:0 24px; border:0; border-radius:12px; background:var(--blue); color:#fff; font:600 16px system-ui; cursor:pointer; }
  .err { background:#FBE9E8; color:#7E1B18; border-radius:12px; padding:12px 16px; }
  code { background:var(--ground); padding:2px 6px; border-radius:6px; word-break:break-all; }
</style>
</head>
<body>
<main>
<h1>Set up Farrell Fitness</h1>
<?php if ($done): ?>
  <section>
    <h2>You're set up</h2>
    <p>Your account and database are ready.</p>
    <p><strong>Next, delete <code>install.php</code> from the server</strong> (it's locked now, but there's no reason to keep it).</p>
    <h2 style="margin-top:20px">Hourly WHOOP sync</h2>
    <p>In cPanel, open Cron Jobs, choose "Once per hour", and use this command:</p>
    <p><code>curl -s "<?= h($done['base_url']) ?>/api/?r=cron/whoop&amp;key=<?= h($done['cron_secret']) ?>" &gt;/dev/null</code></p>
    <p class="hint">This key is also saved in api/config.php as cron_secret.</p>
    <p style="margin-top:20px"><a href="./">Open the app and sign in</a></p>
  </section>
<?php else: ?>
  <p class="hint">This runs once. It writes <code>api/config.php</code>, creates the database tables and your account.</p>
  <?php foreach ($errors as $e): ?><p class="err"><?= h($e) ?></p><?php endforeach; ?>
  <form method="post" autocomplete="off">
    <input type="hidden" name="nonce" value="<?= h($_SESSION['install_nonce']) ?>">
    <?php if (!$hasConfig): ?>
    <section>
      <h2>Database</h2>
      <p class="hint">Create a database and user in cPanel under MySQL Databases, add the user to the database with All Privileges, then enter them here.</p>
      <label for="driver">Database type</label>
      <select id="driver" name="driver"><option value="mysql">MySQL / MariaDB (Bluehost)</option><option value="sqlite">SQLite (local testing)</option></select>
      <label for="db_host">Host</label><input id="db_host" name="db_host" value="<?= h($_POST['db_host'] ?? 'localhost') ?>">
      <label for="db_name">Database name</label><input id="db_name" name="db_name" value="<?= h($_POST['db_name'] ?? '') ?>" placeholder="cpaneluser_fitness">
      <label for="db_user">Database user</label><input id="db_user" name="db_user" value="<?= h($_POST['db_user'] ?? '') ?>">
      <label for="db_pass">Database password</label><input id="db_pass" name="db_pass" type="password">
    </section>
    <section>
      <h2>Site</h2>
      <label for="base_url">App address</label><input id="base_url" name="base_url" value="<?= h($_POST['base_url'] ?? $guessBase) ?>">
      <p class="hint">The exact address you open the app at, without a trailing slash.</p>
      <label for="timezone">Time zone</label><input id="timezone" name="timezone" value="<?= h($_POST['timezone'] ?? 'America/New_York') ?>">
      <label for="units">Units</label>
      <select id="units" name="units"><option value="imperial">Pounds</option><option value="metric">Kilograms</option></select>
    </section>
    <section>
      <h2>Food database and WHOOP</h2>
      <label for="usda_api_key">USDA FoodData Central API key</label><input id="usda_api_key" name="usda_api_key" value="<?= h($_POST['usda_api_key'] ?? '') ?>" placeholder="Free at fdc.nal.usda.gov/api-key-signup">
      <p class="hint">Leave blank to use the shared demo key for now; it's limited to about 30 searches an hour.</p>
      <label for="whoop_client_id">WHOOP client ID</label><input id="whoop_client_id" name="whoop_client_id" value="<?= h($_POST['whoop_client_id'] ?? '') ?>">
      <label for="whoop_client_secret">WHOOP client secret</label><input id="whoop_client_secret" name="whoop_client_secret" type="password">
      <p class="hint">From developer.whoop.com. Set the app's redirect URL to <code><?= h($guessBase) ?>/api/?r=whoop/callback</code>. You can add these later in api/config.php.</p>
    </section>
    <?php endif; ?>
    <section>
      <h2>Your account</h2>
      <label for="username">Username</label><input id="username" name="username" value="<?= h($_POST['username'] ?? '') ?>" autocomplete="username">
      <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password">
      <p class="hint">At least 10 characters.</p>
    </section>
    <button type="submit">Set up</button>
  </form>
<?php endif; ?>
</main>
</body>
</html>

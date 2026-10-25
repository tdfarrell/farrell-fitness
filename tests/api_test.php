<?php
// End-to-end API checks: starts PHP's built-in server on a throwaway SQLite database,
// signs in, and exercises the routes over HTTP.
//   php tests/api_test.php
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../api/lib/db.php';
require __DIR__ . '/../api/lib/util.php';
require __DIR__ . '/../api/lib/seed.php';

$fails = 0;
function check($cond, $msg) { global $fails; echo ($cond ? 'PASS ' : 'FAIL ') . $msg . "\n"; if (!$cond) $fails++; }

$tmp = sys_get_temp_dir() . '/ff_api_' . getmypid();
// FF_TEST_MYSQL="host;db;user;pass" runs the same checks against MySQL/MariaDB (the database is emptied first).
$my = getenv('FF_TEST_MYSQL') ? explode(';', getenv('FF_TEST_MYSQL')) : null;
$dbCfg = $my ? ['driver' => 'mysql', 'host' => $my[0], 'name' => $my[1], 'user' => $my[2], 'pass' => $my[3] ?? ''] : ['driver' => 'sqlite', 'sqlite_path' => "$tmp.sqlite"];
$cfg = ['db' => $dbCfg, 'data_dir' => "$tmp-data", 'base_url' => 'http://127.0.0.1:8099', 'timezone' => 'America/New_York',
    'usda_api_key' => 'TEST', 'whoop' => ['client_id' => '', 'client_secret' => ''], 'cron_secret' => str_repeat('x', 32)];
file_put_contents("$tmp.php", '<?php return ' . var_export($cfg, true) . ';');
putenv("FF_CONFIG=$tmp.php");

// An "old" database: the first release's tables only, so the migration path runs on first request.
config();
if ($my) { db()->exec('SET FOREIGN_KEY_CHECKS = 0'); foreach (db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $t) db()->exec("DROP TABLE `$t`"); }
$old = array_filter(schema_sql($my ? 'mysql' : 'sqlite'), fn($s) => !preg_match('/\b(meta|meal_plans|cardio|health_items|health_doses|labs|glucose|measurements|habits|habit_logs|journal)\b/', $s));
foreach ($old as $s) { try { db()->exec($s); } catch (PDOException $e) { if (!str_contains($e->getMessage(), 'Duplicate')) throw $e; } }
db_insert('users', ['username' => 'tim', 'password_hash' => password_hash('testpass1234', PASSWORD_DEFAULT), 'settings' => null, 'created_at' => time()]);
seed_exercises(1);
$today = date('Y-m-d');
$yday = date('Y-m-d', strtotime('-1 day'));
db_insert('whoop_daily', ['user_id' => 1, 'date' => $today, 'recovery' => 70, 'sleep_hours' => 7.5]);
db_insert('whoop_workouts', ['user_id' => 1, 'whoop_id' => 'w-run-1', 'date' => $yday, 'sport' => 'Running', 'start_at' => "{$yday}T11:00:00.000Z", 'end_at' => "{$yday}T11:40:00.000Z", 'strain' => 12.1, 'kcal' => 480, 'avg_hr' => 150, 'max_hr' => 172]);
db_insert('whoop_workouts', ['user_id' => 1, 'whoop_id' => 'w-lift-1', 'date' => $yday, 'sport' => 'Weightlifting', 'start_at' => "{$yday}T20:00:00.000Z", 'end_at' => "{$yday}T21:00:00.000Z", 'strain' => 9.0]);

$port = 8099;
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', dirname(__DIR__)], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, ['FF_CONFIG' => "$tmp.php"] + getenv());
register_shutdown_function(function () use ($proc, $tmp) {
    proc_terminate($proc);
    foreach (glob("$tmp.*") as $f) @unlink($f);
    if (is_dir("$tmp-data")) exec('rm -rf ' . escapeshellarg("$tmp-data"));
});
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);

$jar = "$tmp.cookies";
function api(string $route, ?array $body = null, array $query = [], array $opts = []) {
    global $port, $jar;
    $ch = curl_init("http://127.0.0.1:$port/api/?" . http_build_query(['r' => $route] + $query));
    $headers = $opts['headers'] ?? ['X-FF-Request: 1', 'Content-Type: application/json'];
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers]);
    if (empty($opts['anonymous'])) curl_setopt_array($ch, [CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar]);
    if ($body !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body)); }
    $res = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    if (!empty($opts['raw'])) return [$status, $res, $type];
    return [$status, json_decode((string) $res, true)];
}

[$st] = api('auth/login', ['username' => 'tim', 'password' => 'testpass1234']);
check($st === 200, 'sign in');

/* migration */
[$st, $r] = api('summary', null, ['from' => $yday, 'to' => $today]);
check($st === 200 && array_key_exists('step_count', $r['days'][1]['whoop'] ?? []), 'old database migrated: whoop_daily has step_count');
check((int) q_val("SELECT v FROM meta WHERE k = 'schema_version'") === SCHEMA_VERSION, 'schema version recorded');

/* meal plans */
[$st, $r] = api('plans/save', ['name' => 'Training day']);
$pid = $r['plan']['id'] ?? 0;
check($st === 200 && $pid > 0, 'create plan');
[$st, $r] = api('plans/add', ['plan_id' => $pid, 'meal' => 'Breakfast', 'food' => ['source' => 'custom', 'name' => 'Oats', 'kcal' => 380, 'protein' => 13, 'carbs' => 67, 'fat' => 7], 'grams' => 50]);
check($st === 200 && abs($r['plan']['items'][0]['kcal'] - 190) < 0.1, 'add food to plan: macros scaled to amount');
[$st, $r] = api('plans/add', ['plan_id' => $pid, 'meal' => 'Lunch', 'quick' => ['name' => 'Burrito', 'protein' => 40, 'carbs' => 80, 'fat' => 20]]);
check($st === 200 && count($r['plan']['items']) === 2 && $r['plan']['items'][1]['kcal'] == 660, 'quick add to plan: calories from macros');
$items = $r['plan']['items']; $items[0]['meal'] = 'Snacks';
[$st, $r] = api('plans/save', ['id' => $pid, 'items' => $items]);
check($st === 200 && $r['plan']['items'][0]['meal'] === 'Snacks', 'edit plan items');
[$st, $r] = api('diary', null, ['date' => $today]);
check(count($r['entries']) === 0, 'planning does not touch the food log');
[$st, $r] = api('plans/log', ['id' => $pid, 'date' => $today]);
[, $d] = api('diary', null, ['date' => $today]);
check($st === 200 && $r['logged'] === 2 && count($d['entries']) === 2, 'log plan to a day');
[$st, $r] = api('plans/duplicate', ['id' => $pid]);
check($st === 200 && count($r['plan']['items']) === 2, 'duplicate plan');
api('plans/delete', ['id' => $r['plan']['id']]);
[, $r] = api('plans');
check(count($r['plans']) === 1, 'delete plan');

/* cardio */
[, $r] = api('cardio', null, ['from' => date('Y-m-d', strtotime('-7 days'))]);
$wh = array_values(array_filter($r['sessions'], fn($s) => $s['source'] === 'whoop'));
check(count($wh) === 1 && $wh[0]['activity'] === 'Run' && $wh[0]['duration_s'] === 2400, 'WHOOP run listed as cardio, lifting left out');
[$st, $r] = api('cardio/save', ['date' => $yday, 'activity' => 'Run', 'distance_m' => 8046.72, 'whoop_id' => 'w-run-1']);
check($st === 200 && $r['session']['strain'] == 12.1 && $r['session']['duration_s'] === 2400 && $r['session']['distance_m'] == 8046.72, 'linking a WHOOP run merges your distance with its time and strain');
[, $r] = api('cardio', null, ['from' => date('Y-m-d', strtotime('-7 days'))]);
check(count($r['sessions']) === 1 && $r['sessions'][0]['source'] === 'logged', 'linked WHOOP workout appears once');
[$st, $r] = api('cardio/save', ['date' => $today, 'activity' => 'Jump rope', 'duration_s' => 600, 'reps' => 1200]);
$jr = $r['session']['id'] ?? 0;
check($st === 200 && $jr > 0, 'log jump rope by hand');
[$st] = api('cardio/save', ['date' => $today, 'activity' => 'Walk']);
check($st === 400, 'cardio needs a time or distance');

/* strength + stats */
$ex = api('exercises')[1]['exercises'];
$bench = array_values(array_filter($ex, fn($e) => $e['name'] === 'Bench press'))[0]['id'];
api('workouts/save', ['date' => $yday, 'name' => 'Upper A', 'sets' => [['exercise_id' => $bench, 'reps' => 5, 'weight_kg' => 100], ['exercise_id' => $bench, 'reps' => 8, 'weight_kg' => 60, 'warmup' => true]]]);
api('workouts/save', ['date' => $today, 'name' => 'Upper A', 'sets' => [['exercise_id' => $bench, 'reps' => 6, 'weight_kg' => 100]]]);
[$st, $r] = api('training/stats');
$b = array_values(array_filter($r['exercises'], fn($e) => $e['exercise_id'] === $bench))[0] ?? null;
check($st === 200 && $r['strength']['workouts'] === 2 && $r['strength']['volume_kg'] == 1100, 'strength totals skip warm-ups');
check($b && abs($b['best_e1rm_kg'] - 120) < 0.01 && $b['best_e1rm_date'] === $today, 'best e1RM record with date');
$run = array_values(array_filter($r['cardio_records'], fn($a) => $a['activity'] === 'Run'))[0] ?? null;
check($run && $run['longest_distance']['distance_m'] == 8046.72 && abs($run['best_pace']['sec_per_km'] - 298.3) < 0.5, 'run records: longest distance and best pace');
check($r['cardio']['distance_m'] == 8047 && $r['cardio']['sessions'] === 2, 'cardio totals');
check(count($r['weeks']) >= 12, 'weekly series for charts');
api('cardio/delete', ['id' => $jr]);

/* health */
[$st, $r] = api('health/items/save', ['name' => 'Vitamin D3', 'dose' => '2,000 IU', 'kind' => 'supplement', 'time_of_day' => 'morning', 'supply' => 30]);
$vd = $r['item']['id'] ?? 0;
check($st === 200 && $vd > 0, 'add a supplement');
[$st, $r] = api('health/dose', ['item_id' => $vd, 'date' => $today, 'taken' => true]);
check($st === 200 && $r['items'][0]['taken_at'] > 0 && $r['items'][0]['supply'] === 29, 'mark taken counts the supply down');
api('health/dose', ['item_id' => $vd, 'date' => $today, 'taken' => false]);
[, $r] = api('health/items', null, ['date' => $today]);
check($r['items'][0]['taken_at'] === null && $r['items'][0]['supply'] === 30, 'untick restores the supply');
[$st] = api('measurements/save', ['date' => $today, 'kind' => 'vo2max', 'value' => 46]);
[$st2] = api('measurements/save', ['date' => $today, 'kind' => 'vo2max', 'value' => 400]);
check($st === 200 && $st2 === 400, 'VO2 max saved, out-of-range rejected');
[$st, $r] = api('labs/save', ['date' => $yday, 'results' => [['marker' => 'LDL cholesterol', 'value' => 134, 'unit' => 'mg/dL', 'ref_high' => 99], ['marker' => 'HbA1c', 'value' => 5.3, 'unit' => '%', 'ref_low' => 4, 'ref_high' => 5.6], ['marker' => '', 'value' => 1]]]);
check($st === 200 && count($r['labs']) === 2, 'save a lab panel, blank rows skipped');
[$st, $r] = api('glucose/save', ['date' => $today, 'time' => '07:10', 'mg_dl' => 92, 'context' => 'fasting']);
[$st2] = api('glucose/save', ['date' => $today, 'mg_dl' => 900]);
check($st === 200 && $st2 === 400, 'blood sugar saved, out-of-range rejected');
[$st, $r] = api('health');
check($st === 200 && count($r['labs_latest']['out_of_range']) === 1 && $r['labs_latest']['out_of_range'][0]['marker'] === 'LDL cholesterol' && count($r['glucose']) === 1, 'health overview flags out-of-range labs');

/* habits */
[$st, $r] = api('habits', null, ['date' => $today]);
check($st === 200 && count($r['habits']) === 10, 'default habits created on first visit');
$byKind = []; foreach ($r['habits'] as $hb) $byKind[$hb['kind']] ??= $hb;
check($byKind['sleep']['done'] && $byKind['sleep']['auto'] && $byKind['sleep']['source'] === 'whoop', '7+ hours of sleep checks itself from WHOOP');
check(!$byKind['weigh_in']['done'], 'weigh-in not done yet');
api('weights/save', ['date' => $today, 'weight_kg' => 90]);
api('health/dose', ['item_id' => $vd, 'date' => $today, 'taken' => true]);
$check = array_values(array_filter($r['habits'], fn($x) => $x['kind'] === 'check'))[0];
api('habits/log', ['habit_id' => $check['id'], 'date' => $today, 'done' => true]);
api('habits/log', ['habit_id' => $check['id'], 'date' => $yday, 'done' => true]);
$mins = $byKind['minutes'];
api('habits/log', ['habit_id' => $mins['id'], 'date' => $today, 'value' => 42, 'done' => false]);
[, $r] = api('habits', null, ['date' => $today]);
$h = []; foreach ($r['habits'] as $hb) $h[$hb['id']] = $hb;
check($h[$byKind['weigh_in']['id']]['done'] && $h[$byKind['meds']['id']]['done'], 'weigh-in and meds check themselves');
check($h[$check['id']]['done'] && $h[$check['id']]['streak'] === 2, 'manual habit and its streak');
check($h[$mins['id']]['done'] && $h[$mins['id']]['value'] == 42, 'minutes habit done once the target is reached');
check(end($r['history'])['done'] >= 5, 'history counts today');
[$st, $r] = api('habits/save', ['name' => 'Read 20 pages', 'slot' => 'evening', 'kind' => 'check']);
check($st === 200 && $r['habit']['slot'] === 'evening', 'add a habit');
api('habits/delete', ['id' => $r['habit']['id']]);

/* journal */
[$st, $r] = api('journal/save', ['date' => $today, 'mood' => 4, 'energy' => 9, 'stress' => 2, 'body' => 'Easy run, felt good.', 'tags' => ['Training', 'Good sleep', 'Training']]);
check($st === 200 && $r['entry']['energy'] === 5 && $r['entry']['tags'] === ['Training', 'Good sleep'], 'journal entry saved, scales clamped, tags de-duplicated');
check(($r['entry']['context']['recovery'] ?? null) === 70 && ($r['entry']['context']['kcal'] ?? null) > 0, 'journal saves the day\'s context');
[, $r] = api('journal/list', null, ['q' => 'easy']);
check(count($r['entries']) === 1 && in_array('Training', $r['tags'], true), 'journal search and tags');
[, $r] = api('habits', null, ['date' => $today]);
check((bool) array_values(array_filter($r['habits'], fn($x) => $x['kind'] === 'journal'))[0]['done'], 'journal habit checks itself');


/* medication schedules */
[$st, $r] = api('health/items/save', ['name' => 'Metformin', 'dose' => '500 mg', 'kind' => 'medication', 'frequency' => 'twice', 'supply' => 18,
    'schedule' => ['times' => [['slot' => 'morning', 'time' => '08:00'], ['slot' => 'evening', 'time' => '19:00']]]]);
$met = $r['item'] ?? [];
check($st === 200 && $met['frequency'] === 'twice' && count($met['schedule']['times']) === 2 && $met['supply_days'] === 9, 'twice-daily item: two dose times, supply lasts 9 days');
$notToday = ((int) date('w') + 2) % 7;
[, $r] = api('health/items/save', ['name' => 'Weekly shot', 'kind' => 'medication', 'frequency' => 'weekly', 'schedule' => ['weekdays' => [$notToday]]]);
$wk = $r['item'];
[, $r] = api('health/items/save', ['name' => 'Ibuprofen', 'dose' => '200 mg', 'frequency' => 'prn', 'supply' => 20, 'schedule' => ['max' => 3]]);
$prn = $r['item'];
[, $r] = api('health/items/save', ['name' => 'B12', 'frequency' => 'interval', 'schedule' => ['every' => 3, 'start' => $today]]);
$b12 = $r['item'];
[, $r] = api('health/items', null, ['date' => $today]);
$by = array_column($r['items'], null, 'id');
check(count($by[$met['id']]['doses']) === 2 && !$by[$wk['id']]['due'] && $by[$wk['id']]['next_due'] > $today && $by[$b12['id']]['due'], 'due today: twice-daily has 2 doses, weekly not due (next date given), every-3-days due on its start');
[$st, $r] = api('health/dose', ['item_id' => $met['id'], 'date' => $today, 'slot' => 1, 'taken' => true]);
$m2 = array_column($r['items'], null, 'id')[$met['id']];
check($st === 200 && $m2['doses'][1]['taken_at'] && !$m2['doses'][0]['taken_at'] && $m2['taken_at'] === null && $m2['supply'] === 17, 'mark the second dose: first still open, supply 17');
[$st] = api('health/dose', ['item_id' => $met['id'], 'date' => $today, 'slot' => 5, 'taken' => true]);
check($st === 400, 'unknown dose slot rejected');
api('health/dose', ['item_id' => $prn['id'], 'date' => $today, 'taken' => true]);
[, $r] = api('health/dose', ['item_id' => $prn['id'], 'date' => $today, 'taken' => true]);
$p = array_column($r['items'], null, 'id')[$prn['id']];
check(count($p['taken_today']) === 2 && $p['supply'] === 18 && $p['doses'] === [], 'as-needed: each tap logs another dose');
[, $r] = api('habits', null, ['date' => $today]);
$medsHabit = array_values(array_filter($r['habits'], fn($x) => $x['kind'] === 'meds'))[0];
check(!$medsHabit['done'] && $medsHabit['due'] === 4 && $medsHabit['value'] == 2, 'meds habit counts scheduled doses (vitamin D, 2 metformin, B12), not as-needed');
api('health/dose', ['item_id' => $met['id'], 'date' => $today, 'slot' => 0, 'taken' => true]);
api('health/dose', ['item_id' => $b12['id'], 'date' => $today, 'taken' => true]);
[, $r] = api('habits', null, ['date' => $today]);
check(array_values(array_filter($r['habits'], fn($x) => $x['kind'] === 'meds'))[0]['done'], 'meds habit done once every due dose is taken');
[$st] = api('health/items/order', ['ids' => [$prn['id'], $vd, $met['id']]]);
[, $r] = api('health/items', null, ['all' => 1]);
check($st === 200 && $r['items'][0]['id'] === $prn['id'], 'reorder the meds list');

/* body measurements */
[$st, $r] = api('measurements/save_many', ['date' => $today, 'values' => ['waist' => 90.8, 'neck' => 40, 'hips' => 102.9, 'arm_l' => 38.7, 'body_fat' => 18.6]]);
check($st === 200 && count(array_filter($r['measurements'], fn($x) => $x['date'] === $today)) >= 5, 'save a set of body measurements');
[$st] = api('measurements/save_many', ['date' => $yday, 'values' => ['waist' => 91, 'neck' => 400]]);
[, $r] = api('measurements', null, ['kind' => 'waist']);
check($st === 400 && count($r['measurements']) === 1, 'one bad value rejects the whole set');
api('measurements/save_many', ['date' => $today, 'values' => ['arm_l' => null]]);
[$st, $r] = api('body');
check($st === 200 && !in_array('arm_l', array_column($r['measurements'], 'kind'), true) && in_array('hips', array_column($r['measurements'], 'kind'), true), 'body screen data; a blank value clears it');

/* progress photos */
$img = imagecreatetruecolor(60, 90); imagefill($img, 0, 0, imagecolorallocate($img, 120, 140, 160));
ob_start(); imagejpeg($img, null, 80); $jpeg = ob_get_clean();
[$st, $r] = api('photos/upload', ['date' => $today, 'pose' => 'front', 'data' => 'data:image/jpeg;base64,' . base64_encode($jpeg), 'thumb' => base64_encode($jpeg)]);
$ph = $r['photo'] ?? [];
check($st === 200 && $ph['width'] === 60 && $ph['height'] === 90, 'upload a progress photo');
[$st] = api('photos/upload', ['date' => $today, 'pose' => 'front', 'data' => base64_encode('<?php echo 1; ?>' . str_repeat('x', 200))]);
check($st === 400, 'non-JPEG upload rejected');
[$st, $raw, $type] = api('photos/file', null, ['id' => $ph['id'], 'size' => 'thumb'], ['raw' => true]);
check($st === 200 && $type === 'image/jpeg' && $raw === $jpeg, 'photo served to its owner');
[$st] = api('photos/file', null, ['id' => $ph['id']], ['raw' => true, 'anonymous' => true]);
check($st === 401, 'photo not served without signing in');
[, $r] = api('photos/upload', ['date' => $today, 'pose' => 'front', 'data' => base64_encode($jpeg)]);
[, $list] = api('photos');
check(count($list['photos']) === 1 && $list['photos'][0]['id'] === $r['photo']['id'] && count(glob("$tmp-data/photos/u1/*")) === 1, 'a new photo replaces the same pose and day, old file removed');
api('photos/delete', ['id' => $r['photo']['id']]);
check(count(glob("$tmp-data/photos/u1/*")) === 0, 'delete removes the file');
api('photos/upload', ['date' => $today, 'pose' => 'side', 'data' => base64_encode($jpeg)]);

/* smart scale sync */
[, $r] = api('sync/status');
check($r['has_key'] === false, 'no sync key yet');
[$st, $r] = api('sync/key', []);
$key = $r['key'] ?? '';
check($st === 200 && str_starts_with($key, 'ffs_'), 'make a sync key');
[$st] = api('sync/scale', ['weight' => 195.8], [], ['headers' => ['Content-Type: application/json'], 'anonymous' => true]);
check($st === 401, 'scale sync needs the key');
[$st, $r] = api('sync/scale', ['key' => $key, 'weight' => '195.8 lb', 'body_fat' => 0.191, 'date' => date('M j, Y', strtotime('-2 days')) . ' at 6:58 AM'], [], ['headers' => ['Content-Type: application/json'], 'anonymous' => true]);
[, $w] = api('weights', null, ['from' => date('Y-m-d', strtotime('-3 days'))]);
$sw = array_values(array_filter($w['weights'], fn($x) => $x['source'] === 'scale'))[0] ?? null;
check($st === 200 && $sw && abs($sw['weight_kg'] - 88.81) < 0.01 && $sw['body_fat'] == 19.1 && $sw['date'] === date('Y-m-d', strtotime('-2 days')), 'Shortcut-style weight, fraction body fat and date are understood');
[$st, $r] = api('sync/scale', ['samples' => [['weight' => 88.5, 'unit' => 'kg', 'date' => $yday], ['weight' => 88.4, 'unit' => 'kg', 'date' => $today]]], [], ['headers' => ['Content-Type: application/json', "Authorization: Bearer $key"], 'anonymous' => true]);
[, $s] = api('sync/status');
check($st === 200 && $r['saved'] === 2 && $s['uses'] === 2 && $s['count'] === 3, 'several samples with a bearer key');

/* push and reminders */
require_once __DIR__ . '/../api/lib/auth.php';
foreach (['settings', 'cardio', 'health', 'habits', 'photos', 'backup', 'push', 'reminders', 'whoop'] as $lib) require_once __DIR__ . "/../api/lib/$lib.php";
[$st, $r] = api('push/key');
check($st === 200 && strlen(b64u_dec($r['public_key'])) === 65, 'VAPID public key served');
[, $uaPub] = p256_new();
[$st, $r] = api('push/subscribe', ['endpoint' => 'https://push.example.test/sub/abc', 'keys' => ['p256dh' => b64u($uaPub), 'auth' => b64u(random_bytes(16))], 'device' => 'Test phone']);
check($st === 200 && $r['devices'] === 1, 'subscribe this device');
[$st] = api('push/subscribe', ['endpoint' => 'http://insecure.test/x', 'keys' => ['p256dh' => b64u($uaPub), 'auth' => b64u(random_bytes(16))]]);
check($st === 400, 'insecure endpoint rejected');
$now = time();
[$st, $r] = api('settings', ['reminders' => ['weigh_in' => ['time' => date('H:i', $now - 120)], 'food' => ['time' => '25:99']]]);
check($st === 200 && $r['settings']['reminders']['food']['time'] === '20:30' && $r['settings']['reminders']['meds']['on'] === true, 'reminder settings saved and cleaned');
[, $r] = api('health/items/save', ['id' => $met['id'], 'name' => 'Metformin', 'frequency' => 'twice', 'schedule' => ['times' => [['slot' => 'morning', 'time' => '08:00'], ['slot' => 'evening', 'time' => date('H:i', $now - 60)]]]]);
api('health/dose', ['item_id' => $met['id'], 'date' => $today, 'slot' => 1, 'taken' => false]);
$sent = [];
$GLOBALS['ff_http_mock'] = function ($method, $url, $headers, $body) use (&$sent) { $sent[] = compact('url', 'headers', 'body'); return [201, '']; };
$keysSent = run_reminders_for(1, $now);
check(in_array('med:' . $met['id'] . ':1', $keysSent, true) && !in_array('weigh_in', $keysSent, true), 'reminder for an untaken dose; weigh-in skipped because it is logged');
check(isset($sent[0]) && $sent[0]['headers']['Content-Encoding'] === 'aes128gcm' && str_starts_with($sent[0]['headers']['Authorization'], 'vapid t='), 'push request is encrypted and VAPID-signed');
$before = count($sent);
run_reminders_for(1, $now + 300);
check(count($sent) === $before, 'a reminder is sent once a day');
$GLOBALS['ff_http_mock'] = fn() => [410, ''];
push_to_user(1, ['title' => 'x']);
check((int) q_val('SELECT COUNT(*) FROM push_subscriptions') === 0, 'expired subscription removed on 410');
unset($GLOBALS['ff_http_mock']);

/* backups */
[$st, $r] = api('backups/run', []);
check($st === 200 && $r['count'] >= 1 && $r['last']['size'] > 100, 'back up now');
[$st, $raw, $type] = api('backups/download', null, ['name' => 'latest'], ['raw' => true]);
check($st === 200 && substr($raw, 0, 2) === "\x1f\x8b" && $type === 'application/gzip', 'download the latest backup (gzip)');
if ($my) {
    $sql = gzdecode($raw);
    check(str_contains($sql, 'CREATE TABLE `med_doses`') && preg_match('/INSERT INTO `med_doses` VALUES/', $sql) && str_contains($sql, 'SET FOREIGN_KEY_CHECKS = 1'), 'MySQL backup is a complete SQL dump');
} else {
    $restored = "$tmp-restore.sqlite";
    file_put_contents($restored, gzdecode($raw));
    $rp = new PDO("sqlite:$restored");
    check((int) $rp->query('SELECT COUNT(*) FROM med_doses')->fetchColumn() > 0, 'backup restores to a working database');
    $rp = null;
}
[$st] = api('backups/download', null, ['name' => '../config.php'], ['raw' => true]);
check($st === 404, 'backup download only serves backup files');
[$st, $r] = api('cron/tick', null, ['key' => str_repeat('x', 32)], ['anonymous' => true]);
check($st === 200 && isset($r['reminders']), 'cron tick runs');
[$st] = api('cron/tick', null, ['key' => 'wrong'], ['anonymous' => true]);
check($st === 403, 'cron tick needs the key');

/* weekly report, insights, overviews */
[$st, $r] = api('report/week', null, ['date' => $today]);
check($st === 200 && $r['training']['lifts'] >= 1 && isset($r['previous'], $r['habits']), 'weekly report totals');
// Bench: 100 x 5 yesterday, 100 x 6 today. It's a new record only when yesterday falls in the previous week.
check(count(array_filter($r['records'], fn($x) => $x['kind'] === 'e1rm' && $x['name'] === 'Bench press')) === (date('N') === '1' ? 1 : 0), 'records are judged against earlier weeks only');
[$st, $r] = api('insights/data', null, ['from' => date('Y-m-d', strtotime('-7 days'))]);
check($st === 200 && !empty($r['days'][$today]['lifts']) && ($r['days'][$today]['journal']['mood'] ?? null) === 4 && !empty($r['days'][$yday]['cardio']), 'insights per-day data: lifts, cardio and journal');
[$st, $r] = api('foods/top');
check($st === 200 && count($r['foods']) === 2, 'most-logged foods');
[, $pl] = api('plans');
[$st] = api('plans/order', ['ids' => array_column($pl['plans'], 'id')]);
check($st === 200, 'reorder meal plans');
[, $sm] = api('summary', null, ['from' => $today, 'to' => $today]);
check(array_key_exists('fiber', $sm['days'][0]), 'summary includes fiber');

/* export */
[$st, $r] = api('export');
check($st === 200 && count($r['journal']) === 1 && count($r['lab_results']) === 2 && count($r['meal_plans']) === 1 && isset($r['habits'], $r['blood_sugar'], $r['measurements'], $r['cardio']), 'export includes the new data');
check(count($r['progress_photos']) === 1 && isset($r['medications_and_supplements'][0]['schedule']) && count($r['doses_taken']) >= 4, 'export includes photos (list only), med schedules and doses');

/* upgrading from version 2: old doses move to the new table */
q('DELETE FROM med_doses');
db_insert('health_doses', ['user_id' => 1, 'item_id' => $vd, 'date' => $yday, 'taken_at' => time()]);
q("UPDATE meta SET v = '2' WHERE k = 'schema_version'");
api('health/items');
check((int) q_val('SELECT COUNT(*) FROM med_doses WHERE item_id = ? AND date = ? AND slot = 0', [$vd, $yday]) === 1 && (int) q_val("SELECT v FROM meta WHERE k = 'schema_version'") === SCHEMA_VERSION, 'version 2 database: doses copied to the new table');

echo $fails ? "\n$fails FAILED\n" : "\nAll API tests passed\n";
exit($fails ? 1 : 0);

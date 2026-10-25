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
$cfg = ['db' => $dbCfg, 'base_url' => 'http://127.0.0.1:8099', 'timezone' => 'America/New_York',
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
register_shutdown_function(function () use ($proc, $tmp) { proc_terminate($proc); foreach (glob("$tmp.*") as $f) @unlink($f); });
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);

$jar = "$tmp.cookies";
function api(string $route, ?array $body = null, array $query = []) {
    global $port, $jar;
    $ch = curl_init("http://127.0.0.1:$port/api/?" . http_build_query(['r' => $route] + $query));
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar,
        CURLOPT_HTTPHEADER => ['X-FF-Request: 1', 'Content-Type: application/json']]);
    if ($body !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body)); }
    $res = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
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

/* export */
[$st, $r] = api('export');
check($st === 200 && count($r['journal']) === 1 && count($r['lab_results']) === 2 && count($r['meal_plans']) === 1 && isset($r['habits'], $r['blood_sugar'], $r['measurements'], $r['cardio']), 'export includes the new data');

echo $fails ? "\n$fails FAILED\n" : "\nAll API tests passed\n";
exit($fails ? 1 : 0);

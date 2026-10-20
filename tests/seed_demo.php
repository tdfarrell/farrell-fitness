<?php
// Fills a LOCAL test database with ~10 weeks of realistic sample data. CLI only; never run on the live site.
//   php tests/seed_demo.php
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../api/lib/db.php';
require __DIR__ . '/../api/lib/util.php';
config();
if ((config()['db']['driver'] ?? '') !== 'sqlite') { fwrite(STDERR, "Refusing to seed a non-SQLite database.\n"); exit(1); }

$uid = 1;
mt_srand(11);
$g = function () { $s = 0; for ($i = 0; $i < 6; $i++) $s += mt_rand() / mt_getrandmax(); return ($s - 3) / sqrt(0.5); };
foreach (['diary_entries', 'weights', 'whoop_daily', 'whoop_workouts', 'checkins', 'days'] as $t) q("DELETE FROM $t WHERE user_id = ?", [$uid]);
q('DELETE FROM workout_sets'); q('DELETE FROM workouts');

$days = 70;
$mass = 90.8;
$start = strtotime(date('Y-m-d') . " -$days days");
$meals = ['Breakfast' => 0.25, 'Lunch' => 0.32, 'Dinner' => 0.33, 'Snacks' => 0.10];
db_update('users', ['settings' => json_encode(['units' => 'imperial', 'goal' => ['type' => 'lose', 'rate_pct' => 0.55], 'height_cm' => 183, 'birth_year' => 1986, 'activity' => 'moderate'])], ['id' => $uid]);

for ($i = 0; $i <= $days; $i++) {
    $date = date('Y-m-d', $start + $i * 86400);
    $isToday = $i === $days;
    $trueE = 2790 + $i * 0.8;
    $kcal = 2280 + $g() * 160;
    if (mt_rand(1, 100) <= 92 || $isToday) {
        $frac = $isToday ? 0.62 : 1;
        foreach ($meals as $m => $share) {
            if ($isToday && $m !== 'Breakfast' && $m !== 'Lunch') continue;
            $k = $kcal * $share * ($isToday ? 1.2 : 1);
            $p = $k * 0.32 / 4; $f = $k * 0.29 / 9; $c = ($k - $p * 4 - $f * 9) / 4;
            db_insert('diary_entries', ['user_id' => $uid, 'date' => $date, 'meal' => $m, 'food_id' => null, 'name' => "$m (sample)", 'brand' => null, 'grams' => null, 'quantity' => 1, 'portion_label' => null,
                'kcal' => round($k), 'protein' => round($p, 1), 'carbs' => round($c, 1), 'fat' => round($f, 1), 'fiber' => null, 'created_at' => time()]);
        }
    }
    if (mt_rand(1, 100) <= 88) db_insert('weights', ['user_id' => $uid, 'date' => $date, 'weight_kg' => round($mass + $g() * 0.35, 2), 'body_fat' => null]);
    $mass += ($kcal - $trueE) / 7700;

    $rec = max(8, min(99, (int) round(62 + $g() * 16)));
    $light = 3.6 + $g() * 0.3; $deep = 1.5 + $g() * 0.2; $rem = 1.9 + $g() * 0.25;
    db_insert('whoop_daily', ['user_id' => $uid, 'date' => $date, 'cycle_id' => (string) (1000 + $i), 'strain' => round(10.5 + $g() * 2.5, 1), 'kcal' => round($trueE + 200 + $g() * 160),
        'avg_hr' => 64, 'max_hr' => 160, 'recovery' => $rec, 'hrv' => round(58 + ($rec - 60) * 0.4 + $g() * 4, 1), 'rhr' => (int) round(53 - ($rec - 60) * 0.06 + $g()),
        'spo2' => 96.2, 'skin_temp' => 33.6, 'sleep_perf' => (int) round(86 + $g() * 6), 'sleep_eff' => 91.0, 'sleep_consistency' => 78,
        'sleep_hours' => round($light + $deep + $rem, 2), 'sleep_need_hours' => 8.0, 'sleep_light' => round($light, 2), 'sleep_deep' => round($deep, 2), 'sleep_rem' => round($rem, 2), 'resp_rate' => 15.4]);
    if ($i % 7 === 5) db_insert('whoop_workouts', ['user_id' => $uid, 'whoop_id' => "w$i", 'date' => $date, 'sport' => 'Cycling', 'start_at' => "{$date}T17:00:00.000Z", 'end_at' => "{$date}T17:45:00.000Z", 'strain' => 10.2, 'kcal' => 480, 'avg_hr' => 128, 'max_hr' => 151]);
}

// Training: upper/lower four days a week with slow progression.
$ex = fn($n) => (int) q_val('SELECT id FROM exercises WHERE user_id = ? AND name = ?', [$uid, $n]);
$plans = [
    'Upper A' => [['Bench press', 88, 6], ['Weighted pull-up', 11, 7], ['Overhead press', 52, 8], ['Chest-supported row', 30, 10]],
    'Lower A' => [['Back squat', 118, 5], ['Romanian deadlift', 100, 8], ['Leg press', 200, 10]],
    'Upper B' => [['Incline dumbbell press', 32, 9], ['Lat pulldown', 70, 10], ['Seated dumbbell press', 26, 10]],
    'Lower B' => [['Deadlift', 160, 4], ['Bulgarian split squat', 24, 8], ['Leg extension', 60, 12]],
];
$order = array_keys($plans);
$w = 0;
for ($i = 0; $i < $days; $i++) {
    $dow = (int) date('N', $start + $i * 86400);
    if (!in_array($dow, [2, 4, 5, 6], true)) continue;
    $name = $order[$w % 4];
    $date = date('Y-m-d', $start + $i * 86400);
    $wid = db_insert('workouts', ['user_id' => $uid, 'date' => $date, 'name' => $name, 'notes' => null, 'duration_min' => 48 + mt_rand(0, 12), 'created_at' => time()]);
    $pos = 0;
    $prog = 1 + 0.004 * $w;
    foreach ($plans[$name] as [$n, $kg, $reps]) {
        $id = $ex($n);
        db_insert('workout_sets', ['workout_id' => $wid, 'exercise_id' => $id, 'position' => $pos++, 'reps' => 8, 'weight_kg' => round($kg * 0.6 / 2.5) * 2.5, 'rpe' => null, 'warmup' => 1]);
        for ($s = 0; $s < 3; $s++) db_insert('workout_sets', ['workout_id' => $wid, 'exercise_id' => $id, 'position' => $pos++, 'reps' => $reps - ($s === 2 ? 1 : 0), 'weight_kg' => round($kg * $prog / 1.25) * 1.25, 'rpe' => null, 'warmup' => 0]);
    }
    $w++;
}

// Past weekly check-ins on Mondays, last one 8 days ago so a new one is due.
foreach ([36, 29, 22, 15, 8] as $k => $back) {
    db_insert('checkins', ['user_id' => $uid, 'date' => date('Y-m-d', strtotime("-$back days")), 'expenditure' => 2600 + $k * 45, 'trend_kg' => 90.5 - $k * 0.45,
        'kcal' => 2160 + $k * 30, 'protein' => 180, 'carbs' => 205 + $k * 7, 'fat' => 72, 'detail' => null]);
}
echo "Seeded $days days of sample data.\n";

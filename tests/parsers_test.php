<?php
// Tests the USDA, Open Food Facts and WHOOP parsers against canned API responses.
//   php tests/parsers_test.php      (uses a throwaway SQLite database)
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../api/lib/db.php';
require __DIR__ . '/../api/lib/util.php';
require __DIR__ . '/../api/lib/auth.php';
require __DIR__ . '/../api/lib/foods.php';
require __DIR__ . '/../api/lib/whoop.php';

$fails = 0;
function check($cond, $msg) { global $fails; echo ($cond ? 'PASS ' : 'FAIL ') . $msg . "\n"; if (!$cond) $fails++; }

// Point config() at a throwaway database through a temporary config file.
$tmp = sys_get_temp_dir() . '/ff_parsers_' . getmypid();
$cfg = ['db' => ['driver' => 'sqlite', 'sqlite_path' => "$tmp.sqlite"], 'base_url' => 'https://fit.example.com', 'timezone' => 'America/New_York',
    'usda_api_key' => 'TEST', 'whoop' => ['client_id' => 'cid', 'client_secret' => 'sec'], 'cron_secret' => str_repeat('x', 32)];
file_put_contents("$tmp.php", '<?php return ' . var_export($cfg, true) . ';');
putenv("FF_CONFIG=$tmp.php");
register_shutdown_function(fn() => array_map('unlink', glob("$tmp.*")));
config();
run_schema(db(), 'sqlite');
db_insert('users', ['username' => 't', 'password_hash' => 'x', 'settings' => null, 'created_at' => time()]);

/* ---------- USDA ---------- */
$searchFoundation = ['fdcId' => 171477, 'description' => 'CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY, COOKED, ROASTED', 'dataType' => 'SR Legacy',
    'foodNutrients' => [
        ['nutrientId' => 1003, 'nutrientNumber' => '203', 'value' => 31.0], ['nutrientId' => 1004, 'nutrientNumber' => '204', 'value' => 3.57],
        ['nutrientId' => 1005, 'nutrientNumber' => '205', 'value' => 0.0], ['nutrientId' => 1008, 'nutrientNumber' => '208', 'value' => 165],
    ],
    'foodMeasures' => [['disseminationText' => '1 cup, chopped or diced', 'gramWeight' => 140], ['disseminationText' => 'Quantity not specified', 'gramWeight' => 172]]];
$f = normalize_usda($searchFoundation);
check($f['kcal'] == 165 && $f['protein'] == 31.0 && $f['fat'] == 3.6, 'USDA search: basic food macros per 100 g');
check($f['name'] === 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'USDA: name cased');
check(count($f['portions']) === 1 && $f['portions'][0]['grams'] == 140, 'USDA: household measure kept, "Quantity not specified" dropped');

$foundationAtwater = ['fdcId' => 2646170, 'description' => 'Chicken, breast, boneless, skinless, raw', 'dataType' => 'Foundation',
    'foodNutrients' => [['nutrientId' => 1003, 'value' => 22.5], ['nutrientId' => 1004, 'value' => 1.93], ['nutrientId' => 2047, 'value' => 118], ['nutrientId' => 1005, 'value' => 0]]];
check(normalize_usda($foundationAtwater)['kcal'] == 118, 'USDA Foundation: Atwater energy used when 1008 missing');

$branded = ['fdcId' => 2345678, 'description' => 'GRILLED CHICKEN BREAST STRIPS', 'dataType' => 'Branded', 'brandOwner' => 'SAMPLE FOODS INC.',
    'gtinUpc' => '012345678905', 'servingSize' => 84, 'servingSizeUnit' => 'g', 'householdServingFullText' => '3 oz',
    'foodNutrients' => [['nutrientId' => 1003, 'value' => 23.8], ['nutrientId' => 1004, 'value' => 2.38], ['nutrientId' => 1005, 'value' => 1.19], ['nutrientId' => 1008, 'value' => 131], ['nutrientId' => 1093, 'value' => 524]]];
$b = normalize_usda($branded);
check($b['kind'] === 'Branded product' && $b['brand'] === 'Sample Foods Inc.', 'USDA branded: brand + kind');
check($b['portions'][0]['label'] === '3 oz (84 g)' && $b['portions'][0]['grams'] == 84.0, 'USDA branded: serving portion from label');
check($b['sodium'] == 524 && $b['barcode'] === '012345678905', 'USDA branded: sodium + UPC');

$detail = ['fdcId' => 171477, 'description' => 'Chicken breast, roasted', 'dataType' => 'SR Legacy',
    'foodNutrients' => [['nutrient' => ['id' => 1008, 'number' => '208'], 'amount' => 165], ['nutrient' => ['id' => 1003, 'number' => '203'], 'amount' => 31],
        ['nutrient' => ['id' => 1004, 'number' => '204'], 'amount' => 3.57], ['nutrient' => ['id' => 1005, 'number' => '205'], 'amount' => 0]],
    'foodPortions' => [['amount' => 1, 'modifier' => 'breast, bone and skin removed', 'gramWeight' => 172, 'portionDescription' => ''],
        ['amount' => 0.5, 'modifier' => 'breast', 'gramWeight' => 86]]];
$d = normalize_usda($detail);
check($d['kcal'] == 165 && $d['protein'] == 31, 'USDA detail: nested nutrient shape');
check($d['portions'][0]['label'] === '1 breast, bone and skin removed (172 g)', 'USDA detail: portion label from amount + modifier');

/* ---------- Open Food Facts ---------- */
$GLOBALS['ff_http_mock'] = function ($m, $url) {
    if (str_contains($url, 'openfoodfacts')) return [200, ['status' => 1, 'product' => ['code' => '0041196910759', 'product_name' => 'Greek Yogurt Nonfat', 'brands' => 'Sample Dairy, Other',
        'serving_size' => '170 g', 'serving_quantity' => 170, 'nutriments' => ['energy-kcal_100g' => 59, 'proteins_100g' => 10.3, 'carbohydrates_100g' => 3.6, 'fat_100g' => 0.4, 'sodium_100g' => 0.036]]]];
    return [404, []];
};
$o = barcode_lookup(1, '0041196910759');
check($o && $o['source'] === 'off' && $o['kcal'] == 59 && $o['brand'] === 'Sample Dairy', 'Open Food Facts barcode lookup');
check($o['portions'][0]['grams'] == 170 && $o['sodium'] == 36.0, 'OFF: serving + sodium mg');
$id = save_food(1, $o);
check(barcode_lookup(1, '0041196910759')['id'] === $id, 'Barcode: saved food found locally next time');
check(barcode_lookup(1, '041196910759')['id'] === $id, 'Barcode: 12-digit UPC finds the 13-digit EAN');

/* ---------- WHOOP ---------- */
check(whoop_local_date('2026-10-20T03:30:00.000Z', '-04:00') === '2026-10-19', 'WHOOP: local date honors timezone offset');
check(whoop_local_date('2026-10-20T11:30:00.000Z', '-04:00') === '2026-10-20', 'WHOOP: morning wake is same local day');

db_insert('whoop_tokens', ['user_id' => 1, 'access_token' => 'old', 'refresh_token' => 'r1', 'expires_at' => time() - 10]);
$calls = [];
$GLOBALS['ff_http_mock'] = function ($m, $url, $headers, $body) use (&$calls) {
    $calls[] = "$m " . preg_replace('/\?.*/', '', $url);
    if (str_contains($url, '/oauth2/token')) {
        parse_str($body, $p);
        return [200, ['access_token' => 'new', 'refresh_token' => 'r2', 'expires_in' => 3600, 'scope' => 'offline']];
    }
    if (($headers['Authorization'] ?? '') !== 'Bearer new') return [401, []];
    $q = [];
    parse_str(parse_url($url, PHP_URL_QUERY) ?? '', $q);
    if (str_contains($url, '/v2/cycle')) {
        if (empty($q['nextToken'])) return [200, ['records' => [['id' => 93845, 'start' => '2026-10-19T10:50:00.000Z', 'end' => '2026-10-20T10:30:00.000Z', 'timezone_offset' => '-04:00', 'score_state' => 'SCORED',
            'score' => ['strain' => 11.37, 'kilojoule' => 12552.0, 'average_heart_rate' => 68, 'max_heart_rate' => 161], 'step_count' => 8423]], 'next_token' => 'page2']];
        return [200, ['records' => [['id' => 93846, 'start' => '2026-10-20T10:30:00.000Z', 'end' => null, 'timezone_offset' => '-04:00', 'score_state' => 'PENDING_SCORE']], 'next_token' => null]];
    }
    if (str_contains($url, '/v2/recovery')) return [200, ['records' => [['cycle_id' => 93845, 'sleep_id' => 'abc', 'created_at' => '2026-10-19T11:00:00.000Z', 'score_state' => 'SCORED',
        'score' => ['user_calibrating' => false, 'recovery_score' => 68, 'resting_heart_rate' => 52, 'hrv_rmssd_milli' => 61.24, 'spo2_percentage' => 95.7, 'skin_temp_celsius' => 33.7]]]]];
    if (str_contains($url, '/v2/activity/sleep')) return [200, ['records' => [
        ['id' => 'abc', 'start' => '2026-10-19T02:40:00.000Z', 'end' => '2026-10-19T10:50:00.000Z', 'timezone_offset' => '-04:00', 'nap' => false, 'score_state' => 'SCORED',
         'score' => ['stage_summary' => ['total_in_bed_time_milli' => 29400000, 'total_awake_time_milli' => 2760000, 'total_light_sleep_time_milli' => 13260000, 'total_slow_wave_sleep_time_milli' => 5880000, 'total_rem_sleep_time_milli' => 7500000],
           'sleep_needed' => ['baseline_milli' => 27000000, 'need_from_sleep_debt_milli' => 1200000, 'need_from_recent_strain_milli' => 600000, 'need_from_recent_nap_milli' => 0],
           'respiratory_rate' => 15.2, 'sleep_performance_percentage' => 92, 'sleep_consistency_percentage' => 81, 'sleep_efficiency_percentage' => 90.6]],
        ['id' => 'nap1', 'start' => '2026-10-19T18:00:00.000Z', 'end' => '2026-10-19T18:30:00.000Z', 'timezone_offset' => '-04:00', 'nap' => true, 'score_state' => 'SCORED', 'score' => []]]]];
    if (str_contains($url, '/v2/activity/workout')) return [200, ['records' => [['id' => 'w-uuid-1', 'start' => '2026-10-19T21:00:00.000Z', 'end' => '2026-10-19T21:52:00.000Z', 'timezone_offset' => '-04:00',
        'sport_name' => 'weightlifting', 'score_state' => 'SCORED', 'score' => ['strain' => 9.8, 'kilojoule' => 1674.0, 'average_heart_rate' => 118, 'max_heart_rate' => 152]],
        ['id' => 'w-uuid-2', 'start' => '2026-10-19T11:00:00.000Z', 'end' => '2026-10-19T11:37:00.000Z', 'timezone_offset' => '-04:00', 'sport_name' => 'running', 'score_state' => 'SCORED',
         'score' => ['strain' => 12.6, 'kilojoule' => 2008.0, 'average_heart_rate' => 152, 'max_heart_rate' => 171, 'percent_recorded' => 100, 'distance_meter' => 6598.2, 'altitude_gain_meter' => 41.5,
           'zone_durations' => ['zone_zero_milli' => 0, 'zone_one_milli' => 120000, 'zone_two_milli' => 360000, 'zone_three_milli' => 840000, 'zone_four_milli' => 720000, 'zone_five_milli' => 180000]]]]]];
    return [404, []];
};
$res = whoop_sync(1, 7);
$row = q_one('SELECT * FROM whoop_daily WHERE user_id = 1 AND date = ?', ['2026-10-19']);
check(in_array('POST https://api.prod.whoop.com/oauth/oauth2/token', $calls, true), 'WHOOP: expired token refreshed');
check(q_val('SELECT refresh_token FROM whoop_tokens WHERE user_id = 1') === 'r2', 'WHOOP: rotated refresh token stored');
check(count(array_filter($calls, fn($c) => str_contains($c, '/v2/cycle'))) === 2, 'WHOOP: paginated with nextToken');
check($row && $row['recovery'] == 68 && $row['hrv'] == 61.2 && $row['rhr'] == 52, 'WHOOP: recovery mapped to cycle day');
check($row['strain'] == 11.4 && $row['kcal'] == 3000, 'WHOOP: strain + kJ converted to kcal');
check(abs($row['sleep_hours'] - 7.4) < 0.01 && $row['sleep_perf'] == 92 && abs($row['sleep_need_hours'] - 8.0) < 0.01, 'WHOOP: sleep hours, performance, need');
check(abs($row['sleep_deep'] - 1.63) < 0.01, 'WHOOP: deep sleep stage');
check(q_val('SELECT COUNT(*) FROM whoop_daily WHERE user_id = 1') == 2, 'WHOOP: unscored cycle stored without blanking data');
$w = q_one('SELECT * FROM whoop_workouts WHERE whoop_id = ?', ['w-uuid-1']);
check($w && $w['sport'] === 'Weightlifting' && $w['kcal'] == 400 && $w['date'] === '2026-10-19', 'WHOOP: workout mapped');
check($row['step_count'] == 8423, 'WHOOP: daily step count from the cycle');
$r = q_one('SELECT * FROM whoop_workouts WHERE whoop_id = ?', ['w-uuid-2']);
check($r && $r['distance_m'] == 6598.2 && $r['altitude_gain_m'] == 41.5 && json_decode($r['zones'], true) === [0, 120, 360, 840, 720, 180], 'WHOOP: run distance, elevation and heart rate zones');
check($w['distance_m'] === null && $w['zones'] === null, 'WHOOP: lifting has no distance or zones');

// Micronutrients, both USDA shapes, and Open Food Facts units (grams per 100 g) converted to mg and mcg.
$mic = normalize_usda(['fdcId' => 7, 'description' => 'SPINACH', 'dataType' => 'SR Legacy', 'foodNutrients' => [
    ['nutrientId' => 1008, 'value' => 23], ['nutrientId' => 1089, 'value' => 2.71], ['nutrient' => ['id' => 1185, 'number' => '430'], 'amount' => 482.9],
    ['nutrientNumber' => '435', 'value' => 194], ['nutrientId' => 1258, 'value' => 0.063]]]);
check($mic['micros'] == ['sat_fat' => 0.063, 'iron' => 2.71, 'vit_k' => 482.9, 'folate' => 194.0], 'USDA: micronutrients from ids and numbers');
check(normalize_usda($branded)['micros'] === null, 'USDA: no micronutrients is null, not an empty list');
check(clean_micros(['iron' => '3', 'vit_c' => -1, 'x' => 2]) === ['iron' => 3.0], 'micronutrients cleaned: numbers only, known keys only');
check(json_decode(entry_micros(['sugar' => 10, 'sodium' => null, 'micros' => '{"calcium":120}'], 50), true) == ['sugar' => 5, 'calcium' => 60], 'entry nutrients scaled to grams eaten');

echo $fails ? "\n$fails FAILED\n" : "\nAll parser tests passed\n";
exit($fails ? 1 : 0);

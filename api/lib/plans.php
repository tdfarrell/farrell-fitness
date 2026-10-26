<?php
// Meal plans: a day of food you can total against your targets without logging it.
// Items are snapshots (name and macros), like diary entries, so editing a food never changes a plan.

const PLAN_ITEM_KEYS = ['meal', 'name', 'brand', 'food_id', 'grams', 'quantity', 'portion_label', 'kcal', 'protein', 'carbs', 'fat', 'fiber'];

function plan_item_clean(array $it): array {
    $num = fn($v, $max) => ($v === null || $v === '' || !is_numeric($v)) ? null : max(0, min($max, round((float) $v, 2)));
    $out = [
        'meal' => mb_substr(trim((string) ($it['meal'] ?? 'Snacks')), 0, 32) ?: 'Snacks',
        'name' => mb_substr(trim((string) ($it['name'] ?? '')), 0, 255) ?: 'Food',
        'brand' => isset($it['brand']) && $it['brand'] !== '' ? mb_substr((string) $it['brand'], 0, 255) : null,
        'food_id' => isset($it['food_id']) && is_numeric($it['food_id']) ? (int) $it['food_id'] : null,
        'grams' => $num($it['grams'] ?? null, 10000),
        'quantity' => $num($it['quantity'] ?? 1, 1000) ?? 1,
        'portion_label' => isset($it['portion_label']) && $it['portion_label'] !== '' ? mb_substr((string) $it['portion_label'], 0, 120) : null,
    ];
    foreach (['kcal' => 20000, 'protein' => 2000, 'carbs' => 2000, 'fat' => 2000] as $k => $max) $out[$k] = $num($it[$k] ?? 0, $max) ?? 0;
    $out['fiber'] = $num($it['fiber'] ?? null, 500);
    return $out;
}

function plan_out(array $r): array {
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'items' => json_decode($r['items'], true) ?: [],
        'position' => (int) $r['position'], 'updated_at' => (int) $r['updated_at']];
}

function plan_owned(int $uid, int $id): array {
    $r = q_one('SELECT * FROM meal_plans WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$r) fail(404, 'Plan not found');
    return $r;
}

function route_plans(int $uid, string $m) {
    return ['plans' => array_map('plan_out', q_all('SELECT * FROM meal_plans WHERE user_id = ? ORDER BY position, id', [$uid]))];
}

/** Create, rename or replace a plan's items. */
function route_plans_save(int $uid, string $m) {
    $name = mb_substr(trim((string) param('name', '')), 0, 80);
    $items = param('items');
    $id = (int) param('id', 0);
    if ($id) {
        $row = plan_owned($uid, $id);
        $data = ['updated_at' => time()];
        if ($name !== '') $data['name'] = $name;
        if (is_array($items)) $data['items'] = json_encode(array_values(array_map(fn($i) => plan_item_clean((array) $i), array_slice($items, 0, 200))));
        db_update('meal_plans', $data, ['id' => $id]);
    } else {
        if ($name === '') fail(400, 'Name the plan');
        if ((int) q_val('SELECT COUNT(*) FROM meal_plans WHERE user_id = ?', [$uid]) >= 50) fail(400, 'You can keep up to 50 plans');
        $id = db_insert('meal_plans', [
            'user_id' => $uid, 'name' => $name,
            'items' => json_encode(is_array($items) ? array_values(array_map(fn($i) => plan_item_clean((array) $i), array_slice($items, 0, 200))) : []),
            'position' => (int) q_val('SELECT COALESCE(MAX(position), 0) + 1 FROM meal_plans WHERE user_id = ?', [$uid]),
            'updated_at' => time(),
        ]);
    }
    return ['plan' => plan_out(q_one('SELECT * FROM meal_plans WHERE id = ?', [$id]))];
}

/** Add a food to a plan. Takes the same food/amount fields as diary/add, or `quick`. */
function route_plans_add(int $uid, string $m) {
    $row = plan_owned($uid, (int) req_num('plan_id'));
    $meal = req_str('meal', 32);
    $quick = param('quick');
    if (is_array($quick)) {
        $n = fn($k) => max(0, (float) ($quick[$k] ?? 0));
        $item = ['meal' => $meal, 'name' => trim((string) ($quick['name'] ?? '')) ?: 'Quick add', 'food_id' => null, 'grams' => null, 'quantity' => 1,
            'kcal' => $n('kcal') ?: ($n('protein') * 4 + $n('carbs') * 4 + $n('fat') * 9), 'protein' => $n('protein'), 'carbs' => $n('carbs'), 'fat' => $n('fat')];
    } else {
        $f = food_for_entry($uid, param('food'));
        $grams = req_num('grams');
        if ($grams <= 0 || $grams > 10000) fail(400, 'Amount must be between 0 and 10,000 g');
        $k = $grams / 100;
        $item = ['meal' => $meal, 'name' => $f['name'], 'brand' => $f['brand'], 'food_id' => (int) $f['id'], 'grams' => $grams,
            'quantity' => opt_num('quantity', 1), 'portion_label' => param('portion_label'),
            'kcal' => round($f['kcal'] * $k, 1), 'protein' => round($f['protein'] * $k, 1), 'carbs' => round($f['carbs'] * $k, 1),
            'fat' => round($f['fat'] * $k, 1), 'fiber' => $f['fiber'] === null ? null : round($f['fiber'] * $k, 1)];
    }
    $items = json_decode($row['items'], true) ?: [];
    if (count($items) >= 200) fail(400, 'A plan can hold up to 200 items');
    $items[] = plan_item_clean($item);
    db_update('meal_plans', ['items' => json_encode($items), 'updated_at' => time()], ['id' => $row['id']]);
    return ['plan' => plan_out(q_one('SELECT * FROM meal_plans WHERE id = ?', [$row['id']]))];
}

function route_plans_duplicate(int $uid, string $m) {
    $row = plan_owned($uid, (int) req_num('id'));
    $id = db_insert('meal_plans', ['user_id' => $uid, 'name' => mb_substr($row['name'] . ' copy', 0, 80), 'items' => $row['items'],
        'position' => (int) q_val('SELECT COALESCE(MAX(position), 0) + 1 FROM meal_plans WHERE user_id = ?', [$uid]), 'updated_at' => time()]);
    return ['plan' => plan_out(q_one('SELECT * FROM meal_plans WHERE id = ?', [$id]))];
}

function route_plans_delete(int $uid, string $m) {
    q('DELETE FROM meal_plans WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/** Copy a plan's items into the food log for a day (optionally one meal only). */
function route_plans_log(int $uid, string $m) {
    $row = plan_owned($uid, (int) req_num('id'));
    $date = req_date();
    $only = param('meal');
    $n = 0;
    foreach (json_decode($row['items'], true) ?: [] as $it) {
        if ($only && $it['meal'] !== $only) continue;
        // Nutrients come from the saved food, scaled to the planned amount.
        $micros = null;
        if (!empty($it['food_id']) && !empty($it['grams'])) {
            $food = q_one('SELECT * FROM foods WHERE id = ? AND user_id = ?', [(int) $it['food_id'], $uid]);
            if ($food) $micros = entry_micros($food, (float) $it['grams']);
        }
        db_insert('diary_entries', [
            'micros' => $micros,
            'user_id' => $uid, 'date' => $date, 'meal' => $it['meal'], 'food_id' => $it['food_id'] ?? null,
            'name' => $it['name'], 'brand' => $it['brand'] ?? null, 'grams' => $it['grams'] ?? null,
            'quantity' => $it['quantity'] ?? 1, 'portion_label' => $it['portion_label'] ?? null,
            'kcal' => $it['kcal'], 'protein' => $it['protein'], 'carbs' => $it['carbs'], 'fat' => $it['fat'], 'fiber' => $it['fiber'] ?? null,
            'created_at' => time(),
        ]);
        $n++;
    }
    return ['logged' => $n];
}

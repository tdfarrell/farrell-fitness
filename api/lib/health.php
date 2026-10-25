<?php
// Health records: medications and supplements (with a daily taken check), lab results,
// blood sugar readings, and occasional measurements such as VO2 max and blood pressure.

const HEALTH_TIMES = ['morning', 'midday', 'evening', 'bedtime', 'any'];
const MEASUREMENT_KINDS = ['vo2max', 'bp', 'body_fat', 'waist'];
const GLUCOSE_CONTEXTS = ['fasting', 'before_meal', 'after_meal_1h', 'after_meal_2h', 'bedtime', 'other'];

function health_item_out(array $r): array {
    return ['id' => (int) $r['id'], 'name' => $r['name'], 'dose' => $r['dose'], 'kind' => $r['kind'], 'time_of_day' => $r['time_of_day'],
        'supply' => $r['supply'] === null ? null : (int) $r['supply'], 'active' => (bool) $r['active'], 'position' => (int) $r['position']];
}

/** Active items with whether each was taken on $date. */
function health_items_for(int $uid, string $date, bool $includeInactive = false): array {
    $rows = q_all('SELECT * FROM health_items WHERE user_id = ?' . ($includeInactive ? '' : ' AND active = 1') . ' ORDER BY position, id', [$uid]);
    $taken = [];
    foreach (q_all('SELECT item_id, taken_at FROM health_doses WHERE user_id = ? AND date = ?', [$uid, $date]) as $d) $taken[(int) $d['item_id']] = (int) $d['taken_at'];
    return array_map(fn($r) => health_item_out($r) + ['taken_at' => $taken[(int) $r['id']] ?? null], $rows);
}

function route_health_items(int $uid, string $m) {
    $date = param('date') ? req_date() : today();
    return ['date' => $date, 'items' => health_items_for($uid, $date, (bool) param('all', false))];
}

function route_health_items_save(int $uid, string $m) {
    $kind = (string) param('kind', 'supplement');
    $time = (string) param('time_of_day', 'morning');
    $data = [
        'name' => req_str('name', 120),
        'dose' => param('dose') ? mb_substr(trim((string) param('dose')), 0, 80) : null,
        'kind' => in_array($kind, ['medication', 'supplement'], true) ? $kind : 'supplement',
        'time_of_day' => in_array($time, HEALTH_TIMES, true) ? $time : 'morning',
        'supply' => ($s = opt_num('supply')) === null ? null : max(0, (int) $s),
        'active' => param('active', true) ? 1 : 0,
    ];
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM health_items WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Item not found');
        db_update('health_items', $data, ['id' => $id]);
    } else {
        $id = db_insert('health_items', $data + ['user_id' => $uid, 'created_at' => time(),
            'position' => (int) q_val('SELECT COALESCE(MAX(position), 0) + 1 FROM health_items WHERE user_id = ?', [$uid])]);
    }
    return ['item' => health_item_out(q_one('SELECT * FROM health_items WHERE id = ?', [$id]))];
}

function route_health_items_delete(int $uid, string $m) {
    $id = (int) req_num('id');
    if (q_one('SELECT id FROM health_items WHERE id = ? AND user_id = ?', [$id, $uid])) {
        q('DELETE FROM health_doses WHERE item_id = ?', [$id]);
        q('DELETE FROM health_items WHERE id = ?', [$id]);
    }
    return ['ok' => true];
}

/** Mark an item taken (or not) on a day. Counts the supply down or back up. */
function route_health_dose(int $uid, string $m) {
    $id = (int) req_num('item_id');
    $item = q_one('SELECT * FROM health_items WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$item) fail(404, 'Item not found');
    $date = req_date();
    $taken = (bool) param('taken', true);
    $had = q_one('SELECT id FROM health_doses WHERE item_id = ? AND date = ?', [$id, $date]);
    if ($taken && !$had) {
        db_insert('health_doses', ['user_id' => $uid, 'item_id' => $id, 'date' => $date, 'taken_at' => time()]);
        if ($item['supply'] !== null && $item['supply'] > 0) q('UPDATE health_items SET supply = supply - 1 WHERE id = ?', [$id]);
    } elseif (!$taken && $had) {
        q('DELETE FROM health_doses WHERE id = ?', [$had['id']]);
        if ($item['supply'] !== null) q('UPDATE health_items SET supply = supply + 1 WHERE id = ?', [$id]);
    }
    return ['items' => health_items_for($uid, $date)];
}

/* ---------- measurements (VO2 max, blood pressure, ...) ---------- */

function route_measurements(int $uid, string $m) {
    $kind = param('kind');
    $rows = $kind
        ? q_all('SELECT * FROM measurements WHERE user_id = ? AND kind = ? ORDER BY date', [$uid, (string) $kind])
        : q_all('SELECT * FROM measurements WHERE user_id = ? ORDER BY date', [$uid]);
    return ['measurements' => array_map(fn($r) => ['id' => (int) $r['id'], 'date' => $r['date'], 'kind' => $r['kind'], 'value' => (float) $r['value'],
        'value2' => $r['value2'] === null ? null : (float) $r['value2'], 'note' => $r['note']], $rows)];
}

function route_measurements_save(int $uid, string $m) {
    $kind = (string) param('kind');
    if (!in_array($kind, MEASUREMENT_KINDS, true)) fail(400, 'Unknown measurement');
    $v = req_num('value');
    $ranges = ['vo2max' => [10, 95], 'bp' => [60, 260], 'body_fat' => [2, 70], 'waist' => [40, 250]];
    if ($v < $ranges[$kind][0] || $v > $ranges[$kind][1]) fail(400, 'That value looks out of range');
    $v2 = opt_num('value2');
    if ($kind === 'bp' && ($v2 === null || $v2 < 30 || $v2 > 160)) fail(400, 'Enter both blood pressure numbers');
    db_upsert('measurements', ['user_id' => $uid, 'date' => req_date(), 'kind' => $kind],
        ['value' => $v, 'value2' => $kind === 'bp' ? $v2 : null, 'note' => param('note') ? mb_substr((string) param('note'), 0, 255) : null]);
    return route_measurements($uid, 'GET');
}

function route_measurements_delete(int $uid, string $m) {
    q('DELETE FROM measurements WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/* ---------- labs ---------- */

function lab_out(array $r): array {
    return ['id' => (int) $r['id'], 'date' => $r['date'], 'marker' => $r['marker'], 'value' => (float) $r['value'], 'unit' => $r['unit'],
        'ref_low' => $r['ref_low'] === null ? null : (float) $r['ref_low'], 'ref_high' => $r['ref_high'] === null ? null : (float) $r['ref_high'], 'note' => $r['note']];
}

function route_labs(int $uid, string $m) {
    return ['labs' => array_map('lab_out', q_all('SELECT * FROM labs WHERE user_id = ? ORDER BY date DESC, marker', [$uid]))];
}

/** Save one panel: a date and a list of results. Rows with an id are updated; rows without are added. */
function route_labs_save(int $uid, string $m) {
    $date = req_date();
    $rows = (array) param('results', []);
    if (!$rows) fail(400, 'Add at least one result');
    $n = fn($v) => ($v === null || $v === '' || !is_numeric($v)) ? null : (float) $v;
    foreach (array_slice($rows, 0, 100) as $r) {
        $marker = mb_substr(trim((string) ($r['marker'] ?? '')), 0, 80);
        $value = $n($r['value'] ?? null);
        if ($marker === '' || $value === null) continue;
        $data = ['date' => $date, 'marker' => $marker, 'value' => $value, 'unit' => mb_substr(trim((string) ($r['unit'] ?? '')), 0, 24) ?: null,
            'ref_low' => $n($r['ref_low'] ?? null), 'ref_high' => $n($r['ref_high'] ?? null),
            'note' => !empty($r['note']) ? mb_substr((string) $r['note'], 0, 255) : null];
        if (!empty($r['id']) && q_one('SELECT id FROM labs WHERE id = ? AND user_id = ?', [(int) $r['id'], $uid])) db_update('labs', $data, ['id' => (int) $r['id']]);
        else db_insert('labs', $data + ['user_id' => $uid]);
    }
    return route_labs($uid, 'GET');
}

function route_labs_delete(int $uid, string $m) {
    if (param('date')) q('DELETE FROM labs WHERE user_id = ? AND date = ?', [$uid, req_date()]);
    else q('DELETE FROM labs WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/* ---------- blood sugar ---------- */

function glucose_out(array $r): array {
    return ['id' => (int) $r['id'], 'date' => $r['date'], 'time' => $r['time'], 'mg_dl' => (float) $r['mg_dl'], 'context' => $r['context'], 'note' => $r['note']];
}

function route_glucose(int $uid, string $m) {
    $to = valid_date((string) param('to', today()));
    $from = valid_date((string) param('from', date('Y-m-d', strtotime("$to -30 days"))));
    return ['readings' => array_map('glucose_out', q_all('SELECT * FROM glucose WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date, time, id', [$uid, $from, $to]))];
}

function route_glucose_save(int $uid, string $m) {
    $v = req_num('mg_dl');
    if ($v < 20 || $v > 600) fail(400, 'Blood sugar must be between 20 and 600 mg/dL');
    $ctx = (string) param('context', 'other');
    $time = (string) param('time', '');
    $data = ['date' => req_date(), 'time' => preg_match('/^\d{2}:\d{2}$/', $time) ? $time : date('H:i'), 'mg_dl' => round($v, 1),
        'context' => in_array($ctx, GLUCOSE_CONTEXTS, true) ? $ctx : 'other', 'note' => param('note') ? mb_substr((string) param('note'), 0, 255) : null];
    if ($id = (int) param('id', 0)) {
        if (!q_one('SELECT id FROM glucose WHERE id = ? AND user_id = ?', [$id, $uid])) fail(404, 'Reading not found');
        db_update('glucose', $data, ['id' => $id]);
    } else {
        $id = db_insert('glucose', $data + ['user_id' => $uid, 'created_at' => time()]);
    }
    return ['reading' => glucose_out(q_one('SELECT * FROM glucose WHERE id = ?', [$id]))];
}

function route_glucose_delete(int $uid, string $m) {
    q('DELETE FROM glucose WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    return ['ok' => true];
}

/** One call for the Health screen. */
function route_health(int $uid, string $m) {
    $date = param('date') ? req_date() : today();
    $labs = route_labs($uid, 'GET')['labs'];
    $latestDate = $labs[0]['date'] ?? null;
    $latest = array_values(array_filter($labs, fn($l) => $l['date'] === $latestDate));
    return [
        'date' => $date,
        'items' => health_items_for($uid, $date),
        'measurements' => route_measurements($uid, 'GET')['measurements'],
        'labs_latest' => ['date' => $latestDate, 'results' => $latest,
            'out_of_range' => array_values(array_filter($latest, fn($l) => ($l['ref_low'] !== null && $l['value'] < $l['ref_low']) || ($l['ref_high'] !== null && $l['value'] > $l['ref_high'])))],
        'glucose' => route_glucose($uid, 'GET')['readings'],
    ];
}

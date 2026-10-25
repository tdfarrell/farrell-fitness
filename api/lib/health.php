<?php
// Health records: medications and supplements (with a daily taken check), lab results,
// blood sugar readings, and occasional measurements such as VO2 max and blood pressure.

const HEALTH_TIMES = ['morning', 'midday', 'evening', 'bedtime', 'any'];
const HEALTH_FREQS = ['daily', 'twice', 'thrice', 'weekly', 'interval', 'prn'];
const DEFAULT_DOSE_TIME = ['morning' => '08:00', 'midday' => '12:30', 'evening' => '19:00', 'bedtime' => '22:00', 'any' => '09:00'];
// Body circumferences are stored in cm. body_fat in %, vo2max in ml/kg/min, bp as systolic/diastolic.
const BODY_KINDS = ['waist', 'hips', 'chest', 'neck', 'shoulders', 'arm_l', 'arm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'];
const MEASUREMENT_KINDS = ['vo2max', 'bp', 'body_fat', 'waist', 'hips', 'chest', 'neck', 'shoulders', 'arm_l', 'arm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'];
const GLUCOSE_CONTEXTS = ['fasting', 'before_meal', 'after_meal_1h', 'after_meal_2h', 'bedtime', 'other'];

/* ---------- medication schedules ----------
 * frequency: daily | twice | thrice | weekly | interval (every N days) | prn (as needed)
 * schedule:  {times: [{slot, time}], weekdays: [0-6], every: N, start: date, max: per-day limit}
 * Each entry in times is one dose on a day it's due. Doses are stored in med_doses by slot index.
 */

function normalize_schedule(string $freq, $raw, string $fallbackSlot = 'morning'): array {
    $raw = is_array($raw) ? $raw : (json_decode((string) $raw, true) ?: []);
    $times = [];
    foreach (array_slice((array) ($raw['times'] ?? []), 0, 6) as $t) {
        $slot = in_array($t['slot'] ?? '', HEALTH_TIMES, true) ? $t['slot'] : 'any';
        $time = preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', (string) ($t['time'] ?? '')) ? $t['time'] : DEFAULT_DOSE_TIME[$slot];
        $times[] = ['slot' => $slot, 'time' => $time];
    }
    $need = ['twice' => 2, 'thrice' => 3][$freq] ?? null;
    $fill = [['morning'], ['morning', 'evening'], ['morning', 'midday', 'evening']];
    if ($freq === 'prn') $times = [];
    elseif ($need !== null) {
        $defaults = $fill[$need - 1];
        while (count($times) < $need) { $sl = $defaults[count($times)]; $times[] = ['slot' => $sl, 'time' => DEFAULT_DOSE_TIME[$sl]]; }
        $times = array_slice($times, 0, $need);
    } elseif (!$times) {
        $times = [['slot' => $fallbackSlot, 'time' => DEFAULT_DOSE_TIME[$fallbackSlot] ?? '08:00']];
    } else {
        $times = array_slice($times, 0, 1);
    }
    $out = ['times' => $times];
    if ($freq === 'weekly') {
        $days = array_values(array_unique(array_filter(array_map('intval', (array) ($raw['weekdays'] ?? [])), fn($d) => $d >= 0 && $d <= 6)));
        sort($days);
        $out['weekdays'] = $days ?: [(int) date('w')];
    }
    if ($freq === 'interval') {
        $out['every'] = max(2, min(60, (int) ($raw['every'] ?? 2)));
        $start = (string) ($raw['start'] ?? '');
        $out['start'] = preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) ? $start : today();
    }
    if ($freq === 'prn') $out['max'] = isset($raw['max']) && $raw['max'] !== '' && $raw['max'] !== null ? max(1, min(24, (int) $raw['max'])) : null;
    return $out;
}

function item_due_on(array $item, string $date): bool {
    $f = $item['frequency']; $s = $item['schedule'];
    if ($f === 'prn') return false;
    if ($f === 'weekly') return in_array((int) date('w', strtotime($date)), $s['weekdays'], true);
    if ($f === 'interval') {
        $d = (int) round((strtotime("$date 12:00") - strtotime($s['start'] . ' 12:00')) / 86400);
        return $d >= 0 && $d % $s['every'] === 0;
    }
    return true;
}

/** Average doses per day, for how long a supply lasts. Null for as-needed. */
function doses_per_day(array $item): ?float {
    $n = count($item['schedule']['times']);
    return match ($item['frequency']) {
        'prn' => null,
        'weekly' => $n * count($item['schedule']['weekdays']) / 7,
        'interval' => $n / $item['schedule']['every'],
        default => (float) $n,
    };
}

function next_due(array $item, string $after): ?string {
    if ($item['frequency'] === 'prn') return null;
    for ($i = 1; $i <= 62; $i++) { $d = date('Y-m-d', strtotime("$after +$i days")); if (item_due_on($item, $d)) return $d; }
    return null;
}

function health_item_out(array $r): array {
    $freq = in_array($r['frequency'] ?? 'daily', HEALTH_FREQS, true) ? $r['frequency'] : 'daily';
    $item = ['id' => (int) $r['id'], 'name' => $r['name'], 'dose' => $r['dose'], 'kind' => $r['kind'], 'time_of_day' => $r['time_of_day'],
        'frequency' => $freq, 'schedule' => normalize_schedule($freq, $r['schedule'] ?? null, $r['time_of_day'] ?: 'morning'),
        'remind' => (bool) ($r['remind'] ?? 1), 'refill_remind' => (bool) ($r['refill_remind'] ?? 1),
        'supply' => $r['supply'] === null ? null : (int) $r['supply'], 'active' => (bool) $r['active'], 'position' => (int) $r['position']];
    $per = doses_per_day($item);
    $item['per_day'] = $per === null ? null : round($per, 3);
    $item['supply_days'] = $item['supply'] !== null && $per ? (int) floor($item['supply'] / $per) : null;
    return $item;
}

/** Items with each dose due on $date and whether it was taken. */
function health_items_for(int $uid, string $date, bool $includeInactive = false): array {
    $rows = q_all('SELECT * FROM health_items WHERE user_id = ?' . ($includeInactive ? '' : ' AND active = 1') . ' ORDER BY position, id', [$uid]);
    $taken = [];
    foreach (q_all('SELECT item_id, slot, taken_at FROM med_doses WHERE user_id = ? AND date = ? ORDER BY slot', [$uid, $date]) as $d) $taken[(int) $d['item_id']][(int) $d['slot']] = (int) $d['taken_at'];
    $last = [];
    foreach (q_all('SELECT item_id, MAX(taken_at) t FROM med_doses WHERE user_id = ? GROUP BY item_id', [$uid]) as $d) $last[(int) $d['item_id']] = (int) $d['t'];
    return array_map(function ($r) use ($taken, $last, $date) {
        $i = health_item_out($r);
        $mine = $taken[$i['id']] ?? [];
        $i['due'] = item_due_on($i, $date);
        $i['doses'] = [];
        if ($i['frequency'] === 'prn') {
            $i['taken_today'] = array_map(fn($slot, $t) => ['slot' => $slot, 'taken_at' => $t], array_keys($mine), array_values($mine));
        } elseif ($i['due']) {
            foreach ($i['schedule']['times'] as $k => $t) $i['doses'][] = ['slot' => $k, 'part' => $t['slot'], 'time' => $t['time'], 'taken_at' => $mine[$k] ?? null];
        }
        $i['last_taken_at'] = $last[$i['id']] ?? null;
        $i['next_due'] = $i['due'] ? $date : next_due($i, $date);
        // Kept for older screens: set once every dose due today is taken.
        $done = $i['doses'] && !array_filter($i['doses'], fn($d) => !$d['taken_at']);
        $i['taken_at'] = $done ? max(array_column($i['doses'], 'taken_at')) : null;
        return $i;
    }, $rows);
}

/** Scheduled doses due and taken per day: [date => ['due' => n, 'taken' => n]]. As-needed items don't count. */
function med_progress(int $uid, string $from, string $to): array {
    $items = array_map('health_item_out', q_all('SELECT * FROM health_items WHERE user_id = ? AND active = 1', [$uid]));
    $items = array_values(array_filter($items, fn($i) => $i['frequency'] !== 'prn'));
    $taken = [];
    foreach (q_all('SELECT item_id, date, slot FROM med_doses WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $d) $taken[$d['date']][(int) $d['item_id']][(int) $d['slot']] = true;
    $out = [];
    for ($d = $from; $d <= $to; $d = date('Y-m-d', strtotime("$d 12:00 +1 day"))) {
        $due = 0; $got = 0;
        foreach ($items as $i) {
            if (!item_due_on($i, $d)) continue;
            $n = count($i['schedule']['times']);
            $due += $n;
            for ($k = 0; $k < $n; $k++) if (!empty($taken[$d][$i['id']][$k])) $got++;
        }
        $out[$d] = ['due' => $due, 'taken' => $got, 'items' => count($items)];
    }
    return $out;
}

function route_health_items(int $uid, string $m) {
    $date = param('date') ? req_date() : today();
    return ['date' => $date, 'items' => health_items_for($uid, $date, (bool) param('all', false))];
}

function route_health_items_save(int $uid, string $m) {
    $kind = (string) param('kind', 'supplement');
    $freq = (string) param('frequency', 'daily');
    $freq = in_array($freq, HEALTH_FREQS, true) ? $freq : 'daily';
    $legacy = (string) param('time_of_day', 'morning');
    $legacy = in_array($legacy, HEALTH_TIMES, true) ? $legacy : 'morning';
    $raw = (array) param('schedule', []);
    if (!isset($raw['times']) && param('time_of_day')) $raw['times'] = [['slot' => $legacy]];
    $schedule = normalize_schedule($freq, $raw, $legacy);
    $data = [
        'name' => req_str('name', 120),
        'dose' => param('dose') ? mb_substr(trim((string) param('dose')), 0, 80) : null,
        'kind' => in_array($kind, ['medication', 'supplement'], true) ? $kind : 'supplement',
        'frequency' => $freq,
        'schedule' => json_encode($schedule),
        'time_of_day' => $schedule['times'][0]['slot'] ?? 'any',
        'remind' => param('remind', true) ? 1 : 0,
        'refill_remind' => param('refill_remind', true) ? 1 : 0,
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

function route_health_items_order(int $uid, string $m) {
    foreach (array_values((array) param('ids', [])) as $i => $id) db_update('health_items', ['position' => $i], ['id' => (int) $id, 'user_id' => $uid]);
    return ['ok' => true];
}

function route_health_items_delete(int $uid, string $m) {
    $id = (int) req_num('id');
    if (q_one('SELECT id FROM health_items WHERE id = ? AND user_id = ?', [$id, $uid])) {
        q('DELETE FROM med_doses WHERE item_id = ?', [$id]);
        q('DELETE FROM health_doses WHERE item_id = ?', [$id]);
        q('DELETE FROM health_items WHERE id = ?', [$id]);
    }
    return ['ok' => true];
}

/**
 * Mark one dose taken (or not). Scheduled items pass the dose's slot; as-needed items add a new
 * dose each time and remove one by slot. Supply counts down and back up.
 */
function route_health_dose(int $uid, string $m) {
    $id = (int) req_num('item_id');
    $row = q_one('SELECT * FROM health_items WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$row) fail(404, 'Item not found');
    $item = health_item_out($row);
    $date = req_date();
    $taken = (bool) param('taken', true);
    $slot = param('slot');
    if ($item['frequency'] === 'prn') {
        if ($taken) $slot = (int) q_val('SELECT COALESCE(MAX(slot), -1) + 1 FROM med_doses WHERE item_id = ? AND date = ?', [$id, $date]);
        elseif ($slot === null) $slot = (int) q_val('SELECT COALESCE(MAX(slot), 0) FROM med_doses WHERE item_id = ? AND date = ?', [$id, $date]);
    } else {
        $slot = (int) ($slot ?? 0);
        if ($slot < 0 || $slot >= max(1, count($item['schedule']['times']))) fail(400, 'Unknown dose');
    }
    $slot = (int) $slot;
    $had = q_one('SELECT id FROM med_doses WHERE item_id = ? AND date = ? AND slot = ?', [$id, $date, $slot]);
    if ($taken && !$had) {
        db_insert('med_doses', ['user_id' => $uid, 'item_id' => $id, 'date' => $date, 'slot' => $slot, 'taken_at' => time()]);
        if ($row['supply'] !== null && $row['supply'] > 0) q('UPDATE health_items SET supply = supply - 1 WHERE id = ?', [$id]);
    } elseif (!$taken && $had) {
        q('DELETE FROM med_doses WHERE id = ?', [$had['id']]);
        if ($row['supply'] !== null) q('UPDATE health_items SET supply = supply + 1 WHERE id = ?', [$id]);
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
    [$lo, $hi] = measurement_range($kind);
    if ($v < $lo || $v > $hi) fail(400, 'That value looks out of range');
    $v2 = opt_num('value2');
    if ($kind === 'bp' && ($v2 === null || $v2 < 30 || $v2 > 160)) fail(400, 'Enter both blood pressure numbers');
    db_upsert('measurements', ['user_id' => $uid, 'date' => req_date(), 'kind' => $kind],
        ['value' => $v, 'value2' => $kind === 'bp' ? $v2 : null, 'note' => param('note') ? mb_substr((string) param('note'), 0, 255) : null]);
    return route_measurements($uid, 'GET');
}

function measurement_range(string $kind): array {
    return ['vo2max' => [10, 95], 'bp' => [60, 260], 'body_fat' => [2, 70], 'neck' => [20, 70], 'arm_l' => [15, 80], 'arm_r' => [15, 80],
        'calf_l' => [15, 80], 'calf_r' => [15, 80], 'thigh_l' => [25, 120], 'thigh_r' => [25, 120]][$kind] ?? (in_array($kind, BODY_KINDS, true) ? [30, 250] : [0, 1000]);
}

/** Save a set of body measurements for one day: values = {kind: number or null}. Null clears that kind. */
function route_measurements_save_many(int $uid, string $m) {
    $date = req_date();
    $values = (array) param('values', []);
    $bad = []; $ops = [];
    foreach ($values as $kind => $v) {
        if (!in_array($kind, MEASUREMENT_KINDS, true) || $kind === 'bp' || $kind === 'vo2max') continue;
        if ($v === null || $v === '') { $ops[$kind] = null; continue; }
        [$lo, $hi] = measurement_range($kind);
        if (!is_numeric($v) || $v < $lo || $v > $hi) { $bad[] = $kind; continue; }
        $ops[$kind] = round((float) $v, 2);
    }
    if ($bad) fail(400, 'These look out of range: ' . implode(', ', $bad));
    foreach ($ops as $kind => $v) {
        if ($v === null) q('DELETE FROM measurements WHERE user_id = ? AND date = ? AND kind = ?', [$uid, $date, $kind]);
        else db_upsert('measurements', ['user_id' => $uid, 'date' => $date, 'kind' => $kind], ['value' => $v, 'value2' => null, 'note' => null]);
    }
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

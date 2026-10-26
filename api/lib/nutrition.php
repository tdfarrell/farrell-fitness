<?php
// Micronutrient totals, filling in nutrients for foods saved before they were tracked, and drink counters.

/** Adds up the nutrients of a list of diary entries. */
function micro_totals(array $entries): array {
    $t = ['fiber' => 0.0];
    foreach (ENTRY_MICROS as $k) $t[$k] = 0.0;
    $have = [];
    foreach ($entries as $e) {
        if ($e['fiber'] !== null) { $t['fiber'] += (float) $e['fiber']; $have['fiber'] = true; }
        $m = !empty($e['micros']) ? (json_decode($e['micros'], true) ?: []) : [];
        foreach ($m as $k => $v) if (array_key_exists($k, $t)) { $t[$k] += (float) $v; $have[$k] = true; }
    }
    // A nutrient none of the foods report is unknown, not zero.
    foreach ($t as $k => $v) $t[$k] = isset($have[$k]) ? round($v, 2) : null;
    return $t;
}

function route_nutrients(int $uid, string $m) {
    $date = req_date();
    $from = date('Y-m-d', strtotime("$date 12:00 -6 days"));
    $rows = q_all('SELECT * FROM diary_entries WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY id', [$uid, $from, $date]);
    $byDay = [];
    foreach ($rows as $r) $byDay[$r['date']][] = $r;

    $dayRows = $byDay[$date] ?? [];
    $sources = [];
    foreach (array_merge(['fiber'], ENTRY_MICROS) as $k) {
        $list = [];
        foreach ($dayRows as $r) {
            $v = $k === 'fiber' ? $r['fiber'] : ((json_decode($r['micros'] ?? 'null', true) ?: [])[$k] ?? null);
            if ($v !== null && $v > 0) $list[] = ['name' => $r['name'], 'value' => round((float) $v, 2)];
        }
        usort($list, fn($a, $b) => $b['value'] <=> $a['value']);
        if ($list) $sources[$k] = array_slice($list, 0, 4);
    }
    $covered = fn($list) => count(array_filter($list, fn($r) => !empty($r['micros'])));

    // Seven-day average over the days that have anything logged.
    $sum = [];
    $n = 0;
    $kcal = 0.0;
    $all = 0; $cov = 0;
    foreach ($byDay as $d => $list) {
        $n++;
        $kcal += array_sum(array_map(fn($r) => (float) $r['kcal'], $list));
        $all += count($list); $cov += $covered($list);
        foreach (micro_totals($list) as $k => $v) {
            if ($v === null) continue;
            $sum[$k] = ($sum[$k] ?? 0) + $v;
        }
    }
    $avg = [];
    foreach (micro_totals([]) as $k => $_) $avg[$k] = isset($sum[$k]) && $n ? round($sum[$k] / $n, 2) : null;

    return [
        'date' => $date,
        'day' => [
            'totals' => micro_totals($dayRows),
            'kcal' => round(array_sum(array_map(fn($r) => (float) $r['kcal'], $dayRows))),
            'entries' => count($dayRows),
            'covered' => $covered($dayRows),
            'sources' => (object) $sources,
        ],
        'week' => ['totals' => $avg, 'kcal' => $n ? round($kcal / $n) : 0, 'days' => $n, 'entries' => $all, 'covered' => $cov],
        'missing' => missing_micro_count($uid),
    ];
}

/** Saved USDA foods logged in the last 90 days that have no nutrient details yet. */
function missing_micro_count(int $uid): int {
    return (int) q_val("SELECT COUNT(*) FROM foods WHERE user_id = ? AND source = 'usda' AND micros IS NULL AND archived = 0 AND last_used_at > ?", [$uid, time() - 90 * 86400]);
}

/**
 * Fetches nutrient details from USDA for up to 15 saved foods, then fills in diary entries from the last
 * 60 days that point at a food that now has them.
 */
function route_foods_backfill(int $uid, string $m) {
    $foods = q_all("SELECT * FROM foods WHERE user_id = ? AND source = 'usda' AND micros IS NULL AND archived = 0 AND last_used_at > ? ORDER BY use_count DESC LIMIT 15",
        [$uid, time() - 90 * 86400]);
    $done = 0;
    $error = null;
    foreach ($foods as $f) {
        try {
            $d = usda_detail((string) $f['source_id']);
            db_update('foods', ['micros' => json_encode($d['micros'] ?? new stdClass()),
                'sugar' => $f['sugar'] ?? $d['sugar'], 'sodium' => $f['sodium'] ?? $d['sodium']], ['id' => $f['id']]);
            $done++;
        } catch (HttpError $e) { $error = $e->getMessage(); break; }
    }
    $since = date('Y-m-d', strtotime('-60 days'));
    $filled = 0;
    foreach (q_all("SELECT e.id, e.grams, f.sugar, f.sodium, f.micros FROM diary_entries e JOIN foods f ON f.id = e.food_id
        WHERE e.user_id = ? AND e.date >= ? AND e.micros IS NULL AND e.grams > 0 AND (f.micros IS NOT NULL OR f.sodium IS NOT NULL OR f.sugar IS NOT NULL)", [$uid, $since]) as $r) {
        $mm = entry_micros($r, (float) $r['grams']);
        if ($mm) { db_update('diary_entries', ['micros' => $mm], ['id' => $r['id']]); $filled++; }
    }
    return ['foods' => $done, 'entries' => $filled, 'missing' => missing_micro_count($uid), 'error' => $error];
}

/* ---------- drinks: water (ml), caffeine (mg), alcohol (standard drinks) ---------- */

const DRINK_KINDS = ['water' => 6000, 'caffeine' => 1000, 'alcohol' => 10];

function drink_out(array $r): array {
    return ['id' => (int) $r['id'], 'date' => $r['date'], 'kind' => $r['kind'], 'amount' => (float) $r['amount'],
        'label' => $r['label'], 'kcal' => $r['kcal'] === null ? null : (float) $r['kcal'],
        'diary_entry_id' => $r['diary_entry_id'] === null ? null : (int) $r['diary_entry_id'], 'logged_at' => (int) $r['logged_at']];
}

function drinks_day(int $uid, string $date): array {
    $list = array_map('drink_out', q_all('SELECT * FROM drinks WHERE user_id = ? AND date = ? ORDER BY logged_at, id', [$uid, $date]));
    $tot = ['water' => 0.0, 'caffeine' => 0.0, 'alcohol' => 0.0];
    foreach ($list as $d) $tot[$d['kind']] += $d['amount'];
    // Alcohol for the Monday-to-Sunday week containing the date.
    $mon = date('Y-m-d', strtotime("$date 12:00 -" . ((int) date('N', strtotime("$date 12:00")) - 1) . ' days'));
    $week = (float) q_val("SELECT COALESCE(SUM(amount), 0) FROM drinks WHERE user_id = ? AND kind = 'alcohol' AND date BETWEEN ? AND ?", [$uid, $mon, $date]);
    return ['date' => $date, 'drinks' => $list, 'totals' => $tot, 'alcohol_week' => round($week, 1)];
}

function route_drinks(int $uid, string $m) { return drinks_day($uid, req_date()); }

function route_drinks_add(int $uid, string $m) {
    $date = req_date();
    $kind = (string) param('kind', '');
    if (!isset(DRINK_KINDS[$kind])) fail(400, 'Unknown drink');
    $amount = req_num('amount');
    // Water can be negative to take some back off; the day total never goes below zero.
    if ($kind === 'water') {
        if ($amount == 0 || abs($amount) > DRINK_KINDS[$kind]) fail(400, 'Amount out of range');
        $have = (float) q_val("SELECT COALESCE(SUM(amount), 0) FROM drinks WHERE user_id = ? AND date = ? AND kind = 'water'", [$uid, $date]);
        if ($amount < 0) $amount = -min(-$amount, $have);
        if ($amount == 0) return drinks_day($uid, $date);
    } elseif ($amount <= 0 || $amount > DRINK_KINDS[$kind]) fail(400, 'Amount out of range');
    $label = param('label') ? mb_substr(trim((string) param('label')), 0, 60) : null;
    $kcal = $kind === 'alcohol' ? opt_num('kcal') : null;
    if ($kcal !== null) $kcal = max(0, min(2000, $kcal));
    $at = param('logged_at') ? max(0, (int) param('logged_at')) : time();

    $entryId = null;
    if ($kind === 'alcohol' && $kcal && param('log_food')) {
        $meal = param('meal') ? mb_substr((string) param('meal'), 0, 32) : 'Snacks';
        $carbs = max(0, min(200, (float) (param('carbs') ?? 0)));
        $entryId = db_insert('diary_entries', [
            'user_id' => $uid, 'date' => $date, 'meal' => $meal, 'food_id' => null,
            'name' => $label ?: 'Drink', 'brand' => null, 'grams' => null, 'quantity' => 1,
            'portion_label' => ($amount == 1 ? '1 standard drink' : "$amount standard drinks"),
            'kcal' => $kcal, 'protein' => 0, 'carbs' => $carbs, 'fat' => 0, 'fiber' => null, 'micros' => null,
            'created_at' => time(),
        ]);
    }
    db_insert('drinks', ['user_id' => $uid, 'date' => $date, 'kind' => $kind, 'amount' => $amount, 'label' => $label,
        'kcal' => $kcal, 'diary_entry_id' => $entryId, 'logged_at' => $at]);
    return drinks_day($uid, $date) + ['logged_food' => $entryId !== null];
}

function route_drinks_delete(int $uid, string $m) {
    $row = q_one('SELECT * FROM drinks WHERE id = ? AND user_id = ?', [(int) req_num('id'), $uid]);
    if (!$row) fail(404, 'Drink not found');
    if ($row['diary_entry_id']) q('DELETE FROM diary_entries WHERE id = ? AND user_id = ?', [(int) $row['diary_entry_id'], $uid]);
    q('DELETE FROM drinks WHERE id = ?', [$row['id']]);
    return drinks_day($uid, $row['date']);
}

/** Daily drink totals for a date range, for Insights and the weekly report. */
function drinks_by_day(int $uid, string $from, string $to, string $cutoff = '14:00'): array {
    $out = [];
    [$ch, $cm] = array_map('intval', explode(':', $cutoff) + [0, 0]);
    foreach (q_all('SELECT date, kind, amount, logged_at FROM drinks WHERE user_id = ? AND date BETWEEN ? AND ?', [$uid, $from, $to]) as $r) {
        $d = &$out[$r['date']];
        $d ??= ['water' => 0.0, 'caffeine' => 0.0, 'alcohol' => 0.0, 'late_caffeine' => 0.0];
        $d[$r['kind']] += (float) $r['amount'];
        if ($r['kind'] === 'caffeine') {
            $mins = (int) date('G', (int) $r['logged_at']) * 60 + (int) date('i', (int) $r['logged_at']);
            if ($mins >= $ch * 60 + $cm) $d['late_caffeine'] += (float) $r['amount'];
        }
        unset($d);
    }
    return $out;
}

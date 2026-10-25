<?php
// Food lookup: USDA FoodData Central (search + details), Open Food Facts (barcodes),
// and the user's own saved foods/recipes. Every food is normalized to values per 100 g.

const USDA_BASE = 'https://api.nal.usda.gov/fdc/v1';

// USDA nutrient ids (new style) and numbers (old style).
const N_KCAL = [1008, '208'];
const N_KCAL_ATWATER = [2047, 2048, '957', '958'];
const N_KJ = [1062, '268'];
const N_PROTEIN = [1003, '203'];
const N_FAT = [1004, '204'];
const N_CARBS = [1005, '205'];
const N_FIBER = [1079, '291'];
const N_SUGAR = [2000, 1063, '269'];
const N_SODIUM = [1093, '307'];

function usda_key(): string { return config()['usda_api_key'] ?: 'DEMO_KEY'; }

/** Pull a nutrient value out of USDA's two different nutrient list shapes. */
function usda_nutrient(array $list, array $ids): ?float {
    foreach ($ids as $want) {
        foreach ($list as $n) {
            $id = $n['nutrientId'] ?? ($n['nutrient']['id'] ?? null);
            $num = $n['nutrientNumber'] ?? ($n['nutrient']['number'] ?? null);
            $val = $n['value'] ?? ($n['amount'] ?? null);
            if ($val === null) continue;
            if ((is_int($want) && (int) $id === $want) || (is_string($want) && (string) $num === $want)) return (float) $val;
        }
    }
    return null;
}

function round1($v): ?float { return $v === null ? null : round((float) $v, 1); }

function normalize_usda(array $f): array {
    $list = $f['foodNutrients'] ?? [];
    $kcal = usda_nutrient($list, N_KCAL) ?? usda_nutrient($list, N_KCAL_ATWATER);
    if ($kcal === null && ($kj = usda_nutrient($list, N_KJ)) !== null) $kcal = $kj / 4.184;
    $protein = usda_nutrient($list, N_PROTEIN) ?? 0;
    $fat = usda_nutrient($list, N_FAT) ?? 0;
    $carbs = usda_nutrient($list, N_CARBS) ?? 0;
    if ($kcal === null) $kcal = $protein * 4 + $carbs * 4 + $fat * 9;

    $portions = [];
    $branded = ($f['dataType'] ?? '') === 'Branded';
    if ($branded && !empty($f['servingSize']) && in_array(strtolower($f['servingSizeUnit'] ?? ''), ['g', 'grm', 'ml', 'mlt'], true)) {
        $label = trim($f['householdServingFullText'] ?? '') ?: 'serving';
        $portions[] = ['label' => "$label ({$f['servingSize']} g)", 'grams' => (float) $f['servingSize']];
    }
    foreach (($f['foodPortions'] ?? []) as $p) {
        if (empty($p['gramWeight'])) continue;
        $desc = trim(($p['portionDescription'] ?? '') !== '' && ($p['portionDescription'] ?? '') !== 'Quantity not specified'
            ? $p['portionDescription']
            : trim(($p['amount'] ?? 1) . ' ' . ($p['modifier'] ?? ($p['measureUnit']['name'] ?? ''))));
        if ($desc === '' || $desc === '1') continue;
        $portions[] = ['label' => $desc . ' (' . round($p['gramWeight']) . ' g)', 'grams' => (float) $p['gramWeight']];
    }
    foreach (($f['foodMeasures'] ?? []) as $p) {
        if (empty($p['gramWeight']) || empty($p['disseminationText']) || $p['disseminationText'] === 'Quantity not specified') continue;
        $portions[] = ['label' => $p['disseminationText'] . ' (' . round($p['gramWeight']) . ' g)', 'grams' => (float) $p['gramWeight']];
    }
    // De-duplicate portions by label.
    $seen = [];
    $portions = array_values(array_filter($portions, function ($p) use (&$seen) {
        if (isset($seen[$p['label']])) return false;
        return $seen[$p['label']] = true;
    }));

    $brand = $f['brandName'] ?? ($f['brandOwner'] ?? null);
    return [
        'source' => 'usda',
        'source_id' => (string) $f['fdcId'],
        'name' => ucfirst(mb_strtolower(trim($f['description'] ?? 'Food'))),
        'brand' => $brand ? ucwords(mb_strtolower($brand)) : null,
        'kind' => $branded ? 'Branded product' : 'USDA basic food',
        'barcode' => $f['gtinUpc'] ?? null,
        'kcal' => round1($kcal),
        'protein' => round1($protein),
        'carbs' => round1($carbs),
        'fat' => round1($fat),
        'fiber' => round1(usda_nutrient($list, N_FIBER)),
        'sugar' => round1(usda_nutrient($list, N_SUGAR)),
        'sodium' => round1(usda_nutrient($list, N_SODIUM)),
        'portions' => array_slice($portions, 0, 8),
    ];
}

function usda_search(string $query, array $types, int $size): array {
    $payload = json_encode(['query' => $query, 'dataType' => $types, 'pageSize' => $size]);
    [$status, $res] = http_request('POST', USDA_BASE . '/foods/search?api_key=' . urlencode(usda_key()),
        ['Content-Type' => 'application/json'], $payload);
    if ($status === 429) fail(429, 'The USDA food database is rate-limiting this server. Add your own USDA API key in config.php.');
    if ($status >= 400 || !is_array($res)) fail(502, 'USDA food search is unavailable right now');
    return array_map('normalize_usda', $res['foods'] ?? []);
}

function usda_detail(string $fdcId): array {
    if (!ctype_digit($fdcId)) fail(400, 'Bad food id');
    [$status, $res] = http_request('GET', USDA_BASE . "/food/$fdcId?api_key=" . urlencode(usda_key()));
    if ($status >= 400 || !is_array($res)) fail(502, 'Could not load that food from USDA');
    return normalize_usda($res);
}

function off_lookup(string $code): ?array {
    [$status, $res] = http_request('GET', 'https://world.openfoodfacts.org/api/v2/product/' . urlencode($code)
        . '.json?fields=code,product_name,brands,nutriments,serving_quantity,serving_size');
    if ($status >= 400 || !is_array($res) || ($res['status'] ?? 0) != 1) return null;
    $p = $res['product'];
    $n = $p['nutriments'] ?? [];
    $kcal = $n['energy-kcal_100g'] ?? (isset($n['energy_100g']) ? $n['energy_100g'] / 4.184 : null);
    if ($kcal === null || empty($p['product_name'])) return null;
    $portions = [];
    if (!empty($p['serving_quantity'])) {
        $portions[] = ['label' => ($p['serving_size'] ?? 'serving'), 'grams' => (float) $p['serving_quantity']];
    }
    return [
        'source' => 'off', 'source_id' => (string) ($p['code'] ?? $code),
        'name' => trim($p['product_name']),
        'brand' => !empty($p['brands']) ? trim(explode(',', $p['brands'])[0]) : null,
        'kind' => 'Branded product', 'barcode' => $code,
        'kcal' => round1($kcal), 'protein' => round1($n['proteins_100g'] ?? 0),
        'carbs' => round1($n['carbohydrates_100g'] ?? 0), 'fat' => round1($n['fat_100g'] ?? 0),
        'fiber' => round1($n['fiber_100g'] ?? null), 'sugar' => round1($n['sugars_100g'] ?? null),
        'sodium' => isset($n['sodium_100g']) ? round1($n['sodium_100g'] * 1000) : null,
        'portions' => $portions,
    ];
}

function barcode_lookup(int $uid, string $code): ?array {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) < 6) fail(400, 'That barcode is too short');
    // The same product can be read as a 12-digit UPC-A or a 13-digit EAN-13 (a leading 0), so try both.
    $variants = array_values(array_unique(array_filter([
        $code,
        strlen($code) === 12 ? '0' . $code : null,
        strlen($code) === 13 && $code[0] === '0' ? substr($code, 1) : null,
    ])));
    foreach ($variants as $v) {
        $local = q_one('SELECT * FROM foods WHERE user_id = ? AND barcode = ? AND archived = 0', [$uid, $v]);
        if ($local) return food_row_out($local);
    }
    foreach ($variants as $v) if ($f = off_lookup($v)) return $f;
    // USDA branded foods are searchable by UPC.
    $hits = usda_search($code, ['Branded'], 5);
    foreach ($hits as $h) if (ltrim((string) $h['barcode'], '0') === ltrim($code, '0')) return $h;
    return null;
}

function food_row_out(array $r): array {
    return [
        'id' => (int) $r['id'], 'source' => $r['source'], 'source_id' => $r['source_id'],
        'name' => $r['name'], 'brand' => $r['brand'], 'barcode' => $r['barcode'],
        'kind' => ['custom' => 'My food', 'recipe' => 'Recipe', 'usda' => 'USDA', 'off' => 'Branded product'][$r['source']] ?? $r['source'],
        'kcal' => (float) $r['kcal'], 'protein' => (float) $r['protein'], 'carbs' => (float) $r['carbs'], 'fat' => (float) $r['fat'],
        'fiber' => $r['fiber'] === null ? null : (float) $r['fiber'],
        'sugar' => $r['sugar'] === null ? null : (float) $r['sugar'],
        'sodium' => $r['sodium'] === null ? null : (float) $r['sodium'],
        'portions' => json_decode($r['portions'] ?? '[]', true) ?: [],
        'recipe' => $r['recipe'] ? json_decode($r['recipe'], true) : null,
        'use_count' => (int) $r['use_count'],
    ];
}

/** Store (or refresh) a food in the user's library and return its local id. */
function save_food(int $uid, array $f): int {
    $source = in_array($f['source'] ?? '', ['usda', 'off', 'custom', 'recipe'], true) ? $f['source'] : 'custom';
    $sourceId = (string) ($f['source_id'] ?? '');
    if ($sourceId === '') $sourceId = bin2hex(random_bytes(8));
    $name = mb_substr(trim((string) ($f['name'] ?? '')), 0, 255);
    if ($name === '') fail(400, 'Food needs a name');
    $portions = [];
    foreach ((array) ($f['portions'] ?? []) as $p) {
        if (!empty($p['label']) && is_numeric($p['grams'] ?? null) && $p['grams'] > 0) {
            $portions[] = ['label' => mb_substr((string) $p['label'], 0, 120), 'grams' => (float) $p['grams']];
        }
    }
    $num = fn($k) => isset($f[$k]) && is_numeric($f[$k]) ? max(0, (float) $f[$k]) : null;
    $data = [
        'name' => $name,
        'brand' => isset($f['brand']) && $f['brand'] !== '' ? mb_substr((string) $f['brand'], 0, 255) : null,
        'barcode' => !empty($f['barcode']) ? preg_replace('/\D/', '', (string) $f['barcode']) : null,
        'kcal' => $num('kcal') ?? 0, 'protein' => $num('protein') ?? 0, 'carbs' => $num('carbs') ?? 0, 'fat' => $num('fat') ?? 0,
        'fiber' => $num('fiber'), 'sugar' => $num('sugar'), 'sodium' => $num('sodium'),
        'portions' => json_encode(array_slice($portions, 0, 12)),
        'recipe' => isset($f['recipe']) ? json_encode($f['recipe']) : null,
        'archived' => 0,
    ];
    if (!empty($f['id']) && in_array($source, ['custom', 'recipe'], true)) {
        db_update('foods', $data, ['id' => (int) $f['id'], 'user_id' => $uid]);
        return (int) $f['id'];
    }
    $id = db_upsert('foods', ['user_id' => $uid, 'source' => $source, 'source_id' => $sourceId], $data + ['created_at' => time()]);
    return (int) ($id ?: q_val('SELECT id FROM foods WHERE user_id = ? AND source = ? AND source_id = ?', [$uid, $source, $sourceId]));
}

function search_foods(int $uid, string $query): array {
    $like = '%' . str_replace(['%', '_'], ['\\%', '\\_'], $query) . '%';
    $mine = array_map('food_row_out', q_all(
        "SELECT * FROM foods WHERE user_id = ? AND archived = 0 AND (name LIKE ? OR brand LIKE ?) ORDER BY use_count DESC, name LIMIT 8",
        [$uid, $like, $like]
    ));
    $generic = [];
    $branded = [];
    $error = null;
    try {
        $generic = usda_search($query, ['Foundation', 'SR Legacy'], 10);
        $branded = usda_search($query, ['Branded'], 20);
    } catch (HttpError $e) {
        $error = $e->getMessage();
    }
    // Skip USDA hits the user already has saved.
    $have = [];
    foreach ($mine as $m) if ($m['source'] === 'usda') $have[$m['source_id']] = true;
    $usda = array_values(array_filter(array_merge($generic, $branded), fn($f) => !isset($have[$f['source_id']])));
    return ['mine' => $mine, 'results' => $usda, 'error' => $error];
}

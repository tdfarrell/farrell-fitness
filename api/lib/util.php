<?php
// Request/response helpers and outbound HTTP.

class HttpError extends Exception {
    public int $status;
    public function __construct(int $status, string $message) {
        parent::__construct($message);
        $this->status = $status;
    }
}

function fail(int $status, string $message): void { throw new HttpError($status, $message); }

function json_out($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function body(): array {
    static $b = null;
    if ($b === null) {
        $raw = file_get_contents('php://input');
        $b = $raw ? json_decode($raw, true) : [];
        if (!is_array($b)) $b = [];
    }
    return $b;
}

function param(string $k, $default = null) {
    $b = body();
    if (array_key_exists($k, $b)) return $b[$k];
    return $_GET[$k] ?? $default;
}

function req_str(string $k, int $max = 255): string {
    $v = param($k);
    if (!is_string($v) || trim($v) === '') fail(400, "Missing $k");
    return mb_substr(trim($v), 0, $max);
}

function opt_num(string $k, ?float $default = null): ?float {
    $v = param($k);
    if ($v === null || $v === '') return $default;
    if (!is_numeric($v)) fail(400, "$k must be a number");
    return (float) $v;
}

function req_num(string $k): float {
    $v = opt_num($k);
    if ($v === null) fail(400, "Missing $k");
    return $v;
}

function valid_date(string $d): string {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) || !checkdate((int) substr($d, 5, 2), (int) substr($d, 8, 2), (int) substr($d, 0, 4))) {
        fail(400, 'Dates must be YYYY-MM-DD');
    }
    return $d;
}
function req_date(string $k = 'date'): string { return valid_date((string) param($k, '')); }

function today(): string { return date('Y-m-d'); }

function base_url(): string { return rtrim(config()['base_url'], '/'); }

/** Outbound HTTP via cURL. Returns [status, decoded body or raw string]. */
function http_request(string $method, string $url, array $headers = [], $body = null, int $timeout = 20): array {
    // Test hook: tests/ can swap in canned responses. Never set in production.
    if (PHP_SAPI === 'cli' && isset($GLOBALS['ff_http_mock'])) return ($GLOBALS['ff_http_mock'])($method, $url, $headers, $body);
    $ch = curl_init($url);
    $h = ['Accept: application/json', 'User-Agent: FarrellFitness/1.0 (personal tracker)'];
    foreach ($headers as $k => $v) $h[] = "$k: $v";
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => $h,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    if ($resp === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new HttpError(502, "Upstream request failed: $err");
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $decoded = json_decode($resp, true);
    return [$status, $decoded ?? $resp];
}

function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }

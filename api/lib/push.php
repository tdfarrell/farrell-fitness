<?php
// Web push notifications, without Composer: VAPID (RFC 8292) signs each request with an ES256
// token, and the message is encrypted for the browser with aes128gcm (RFC 8291). The keys are
// made on first use and kept in the meta table. iPhone supports this for apps added to the
// Home Screen (iOS 16.4 and later).

function b64u(string $bin): string { return rtrim(strtr(base64_encode($bin), '+/', '-_'), '='); }
function b64u_dec(string $s): string {
    $r = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
    if ($r === false) throw new HttpError(400, 'Bad key encoding');
    return $r;
}

/** DER length prefix. */
function der_len(int $n): string { return $n < 128 ? chr($n) : ($n < 256 ? "\x81" . chr($n) : "\x82" . pack('n', $n)); }

/** PEM for a P-256 public key given as an uncompressed 65-byte point. */
function p256_public_pem(string $point): string {
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $point;
    return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
}

/** PEM for a P-256 private key from its 32-byte scalar and public point (SEC1 form). */
function p256_private_pem(string $d, string $point): string {
    $der = "\x30\x77\x02\x01\x01\x04\x20" . $d . "\xa0\x0a\x06\x08" . hex2bin('2a8648ce3d030107') . "\xa1\x44\x03\x42\x00" . $point;
    return "-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n";
}

/** New P-256 key pair: [private key resource, 65-byte public point, 32-byte private scalar]. */
function p256_new(): array {
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$key) throw new RuntimeException('This server can\'t make P-256 keys (OpenSSL EC support is missing).');
    $d = openssl_pkey_get_details($key)['ec'];
    $pad = fn($s) => str_pad($s, 32, "\0", STR_PAD_LEFT);
    return [$key, "\x04" . $pad($d['x']) . $pad($d['y']), $pad($d['d'])];
}

/** The app's VAPID key pair, made once: ['public' => base64url point, 'private_pem' => PEM]. */
function vapid_keys(): array {
    $pub = db_meta_get('vapid_public');
    $priv = db_meta_get('vapid_private');
    if (!$pub || !$priv) {
        [, $point, $d] = p256_new();
        $pub = b64u($point); $priv = b64u($d);
        db_meta_set('vapid_public', $pub);
        db_meta_set('vapid_private', $priv);
    }
    return ['public' => $pub, 'private_pem' => p256_private_pem(b64u_dec($priv), b64u_dec($pub))];
}

/** ES256 JWT for the push service's origin. */
function vapid_jwt(string $endpoint, array $keys, ?int $now = null): string {
    $u = parse_url($endpoint);
    $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $contact = config()['push_contact'] ?? ('mailto:noreply@' . (parse_url(base_url(), PHP_URL_HOST) ?: 'localhost'));
    $claims = ['aud' => $aud, 'exp' => ($now ?? time()) + 12 * 3600, 'sub' => $contact];
    $input = b64u(json_encode(['typ' => 'JWT', 'alg' => 'ES256'])) . '.' . b64u(json_encode($claims, JSON_UNESCAPED_SLASHES));
    openssl_sign($input, $der, openssl_pkey_get_private($keys['private_pem']), OPENSSL_ALGO_SHA256);
    return $input . '.' . b64u(der_to_raw_sig($der));
}

/** OpenSSL gives an ASN.1 DER signature; JWS wants r and s as 32 bytes each. */
function der_to_raw_sig(string $der): string {
    $p = 2;
    if (ord($der[1]) & 0x80) $p += ord($der[1]) & 0x7f;
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        $len = ord($der[$p + 1]);
        $int = substr($der, $p + 2, $len);
        $out .= str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
        $p += 2 + $len;
    }
    return $out;
}

/** Encrypt $plain for one subscription (aes128gcm). Returns the request body. */
function webpush_encrypt(string $plain, string $uaPublicB64, string $authB64, ?array $testKeys = null): string {
    $uaPublic = b64u_dec($uaPublicB64);
    $auth = b64u_dec($authB64);
    if (strlen($uaPublic) !== 65 || strlen($auth) !== 16) throw new HttpError(400, 'Bad subscription keys');
    [$asKey, $asPublic] = $testKeys ?? p256_new();
    $secret = openssl_pkey_derive(openssl_pkey_get_public(p256_public_pem($uaPublic)), $asKey, 32);
    if ($secret === false) throw new RuntimeException('Key agreement failed');
    $hmac = fn($key, $data) => hash_hmac('sha256', $data, $key, true);
    $prkKey = $hmac($auth, $secret);
    $ikm = $hmac($prkKey, "WebPush: info\0" . $uaPublic . $asPublic . "\x01");
    $salt = $testKeys[2] ?? random_bytes(16);
    $prk = $hmac($salt, $ikm);
    $cek = substr($hmac($prk, "Content-Encoding: aes128gcm\0\x01"), 0, 16);
    $nonce = substr($hmac($prk, "Content-Encoding: nonce\0\x01"), 0, 12);
    $tag = '';
    $cipher = openssl_encrypt($plain . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
    return $salt . pack('N', 4096) . chr(65) . $asPublic . $cipher . $tag;
}

/** Send one notification. Returns the HTTP status; 404 and 410 mean the subscription is gone. */
function webpush_send(array $sub, array $message, int $ttl = 3600 * 6): int {
    $keys = vapid_keys();
    $body = webpush_encrypt(json_encode($message, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $sub['p256dh'], $sub['auth']);
    [$status] = http_request('POST', $sub['endpoint'], [
        'TTL' => (string) $ttl,
        'Urgency' => 'normal',
        'Content-Type' => 'application/octet-stream',
        'Content-Encoding' => 'aes128gcm',
        'Authorization' => 'vapid t=' . vapid_jwt($sub['endpoint'], $keys) . ', k=' . $keys['public'],
    ], $body, 15);
    if ($status === 404 || $status === 410) q('DELETE FROM push_subscriptions WHERE id = ?', [$sub['id']]);
    elseif ($status >= 200 && $status < 300) q('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?', [time(), $sub['id']]);
    return (int) $status;
}

/** Send to every device the user has turned reminders on for. Returns how many accepted it. */
function push_to_user(int $uid, array $message): int {
    $ok = 0;
    foreach (q_all('SELECT * FROM push_subscriptions WHERE user_id = ?', [$uid]) as $sub) {
        try { $s = webpush_send($sub, $message); if ($s >= 200 && $s < 300) $ok++; }
        catch (Throwable $e) { error_log('[farrell-fitness] push: ' . $e->getMessage()); }
    }
    return $ok;
}

/* ---------- routes ---------- */

function route_push_key(int $uid, string $m) {
    return ['public_key' => vapid_keys()['public'],
        'devices' => (int) q_val('SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?', [$uid])];
}

function route_push_subscribe(int $uid, string $m) {
    $endpoint = (string) param('endpoint', '');
    $keys = (array) param('keys', []);
    if (!preg_match('#^https://#', $endpoint) || strlen($endpoint) > 1000) fail(400, 'Bad subscription');
    $p256 = (string) ($keys['p256dh'] ?? ''); $auth = (string) ($keys['auth'] ?? '');
    if (strlen(b64u_dec($p256)) !== 65 || strlen(b64u_dec($auth)) !== 16) fail(400, 'Bad subscription keys');
    db_upsert('push_subscriptions', ['endpoint_hash' => hash('sha256', $endpoint)], [
        'user_id' => $uid, 'endpoint' => $endpoint, 'p256dh' => $p256, 'auth' => $auth,
        'device' => mb_substr((string) param('device', ''), 0, 120) ?: null, 'created_at' => time(),
    ]);
    return route_push_key($uid, 'GET');
}

function route_push_unsubscribe(int $uid, string $m) {
    $endpoint = (string) param('endpoint', '');
    if ($endpoint !== '') q('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [$uid, hash('sha256', $endpoint)]);
    else q('DELETE FROM push_subscriptions WHERE user_id = ?', [$uid]);
    return route_push_key($uid, 'GET');
}

function route_push_test(int $uid, string $m) {
    $n = push_to_user($uid, ['title' => 'Reminders are on', 'body' => 'This is how Farrell Fitness reminders will look.', 'url' => '#/today', 'tag' => 'test']);
    if (!$n) fail(400, 'No device accepted the test. Turn reminders off and on again on this device.');
    return ['sent' => $n];
}

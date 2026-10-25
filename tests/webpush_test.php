<?php
// Web push: the PHP encryption and VAPID signing are checked by an independent Node decoder.
//   php tests/webpush_test.php
if (PHP_SAPI !== 'cli') exit;
require __DIR__ . '/../api/lib/db.php';
require __DIR__ . '/../api/lib/util.php';
require __DIR__ . '/../api/lib/push.php';

$fails = 0;
function check($cond, $msg) { global $fails; echo ($cond ? 'PASS ' : 'FAIL ') . $msg . "\n"; if (!$cond) $fails++; }

$tmp = sys_get_temp_dir() . '/ff_push_' . getmypid() . '.php';
file_put_contents($tmp, '<?php return ' . var_export(['db' => ['driver' => 'sqlite', 'sqlite_path' => ':memory:'], 'base_url' => 'https://fit.example.com', 'timezone' => 'UTC'], true) . ';');
putenv("FF_CONFIG=$tmp");
config();

// A "browser" subscription.
[, $uaPublic, $uaD] = p256_new();
$auth = random_bytes(16);
$message = json_encode(['title' => 'Weigh in', 'body' => 'Step on the scale ✓', 'url' => '#/weight']);
$body = webpush_encrypt($message, b64u($uaPublic), b64u($auth));
check(strlen($body) === 16 + 4 + 1 + 65 + strlen($message) + 1 + 16, 'encrypted body has the aes128gcm header and one record');

[, $vPub, $vD] = p256_new();
$keys = ['public' => b64u($vPub), 'private_pem' => p256_private_pem($vD, $vPub)];
$jwt = vapid_jwt('https://web.push.apple.com/QGxyz123', $keys, 1_800_000_000);

$proc = proc_open(['node', __DIR__ . '/webpush_decrypt.mjs'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
fwrite($pipes[0], json_encode(['body' => b64u($body), 'ua_private' => b64u($uaD), 'auth' => b64u($auth), 'jwt' => $jwt, 'vapid_public' => $keys['public']]));
fclose($pipes[0]);
$res = json_decode(stream_get_contents($pipes[1]), true);
$err = stream_get_contents($pipes[2]);
proc_close($proc);
if ($err) echo $err;
check(($res['plaintext'] ?? null) === $message && ($res['delimiter'] ?? null) === 2 && ($res['rs'] ?? 0) === 4096, 'browser-side decryption recovers the message');
check(($res['jwt_valid'] ?? false) === true, 'VAPID token signature verifies with the advertised public key');
check(($res['claims']['aud'] ?? '') === 'https://web.push.apple.com' && ($res['claims']['exp'] ?? 0) === 1_800_000_000 + 43200 && str_starts_with($res['claims']['sub'] ?? '', 'mailto:'), 'VAPID claims: audience is the push origin, 12-hour expiry, contact');
@unlink($tmp);
echo $fails ? "\n$fails FAILED\n" : "\nAll web push tests passed\n";
exit($fails ? 1 : 0);

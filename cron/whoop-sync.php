<?php
// Command-line WHOOP sync for cPanel Cron Jobs, as an alternative to the curl URL:
//   php /home/USERNAME/public_html/PATH/cron/whoop-sync.php
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require __DIR__ . '/../api/lib/db.php';
require __DIR__ . '/../api/lib/util.php';
require __DIR__ . '/../api/lib/auth.php';
require __DIR__ . '/../api/lib/whoop.php';

config();
foreach (q_all('SELECT user_id FROM whoop_tokens') as $r) {
    try {
        $res = whoop_sync((int) $r['user_id']);
        echo date('c') . " user {$r['user_id']}: {$res['days']} days, {$res['workouts']} workouts\n";
    } catch (Throwable $e) {
        echo date('c') . " user {$r['user_id']}: " . $e->getMessage() . "\n";
    }
}

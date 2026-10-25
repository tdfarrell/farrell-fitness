<?php
// One cron job for everything scheduled: reminders, WHOOP sync (about hourly) and the nightly
// backup (after 3 am). In cPanel > Cron Jobs, run it every 15 minutes:
//   php /home/USERNAME/public_html/PATH/cron/tick.php
// or call api/?r=cron/tick&key=CRON_SECRET with curl.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
foreach (['db', 'util', 'auth', 'settings', 'foods', 'whoop', 'plans', 'cardio', 'health', 'habits', 'photos', 'backup', 'push', 'reminders', 'sync', 'report'] as $lib) {
    require __DIR__ . "/../api/lib/$lib.php";
}
config();
ensure_schema();
$out = run_tick();
echo json_encode($out, JSON_UNESCAPED_SLASHES) . "\n";

<?php
// Nightly database backups, kept in data/backups/ (never served by the web server).
// Keeps the last 30 days, plus the earliest backup from each of the last 6 months.
// MySQL backups are gzipped SQL that phpMyAdmin can import; SQLite backups are a gzipped copy
// of the database file. Progress photos are files on the server and aren't part of the dump.

const BACKUP_KEEP_DAYS = 30;
const BACKUP_KEEP_MONTHS = 6;

function backup_dir(): string {
    $base = config()['data_dir'] ?? (__DIR__ . '/../../data');
    $dir = rtrim($base, '/') . '/backups';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    if (!is_file("$dir/.htaccess")) file_put_contents("$dir/.htaccess", "Require all denied\n");
    return $dir;
}

/** Backups, newest first: [name, size, created_at]. */
function backup_list(): array {
    $out = [];
    foreach (glob(backup_dir() . '/ff-*') ?: [] as $f) {
        $n = basename($f);
        if (!preg_match('/^ff-(\d{4}-\d{2}-\d{2})-(\d{4})\.(sql|sqlite)\.gz$/', $n, $mm)) continue;
        $out[] = ['name' => $n, 'date' => $mm[1], 'size' => filesize($f), 'created_at' => filemtime($f)];
    }
    usort($out, fn($a, $b) => strcmp($b['name'], $a['name']));
    return $out;
}

function sql_quote(PDO $pdo, $v): string {
    if ($v === null) return 'NULL';
    if (is_int($v) || is_float($v)) return (string) $v;
    return $pdo->quote((string) $v);
}

/** Writes a backup now and prunes old ones. Returns the new backup's entry. */
function backup_run(): array {
    $cfg = config()['db'];
    $dir = backup_dir();
    $stamp = date('Y-m-d-Hi');
    $driver = $cfg['driver'] ?? 'mysql';
    if ($driver === 'sqlite') {
        $tmp = "$dir/.tmp-" . bin2hex(random_bytes(6)) . '.sqlite';
        db()->exec('VACUUM INTO ' . db()->quote($tmp));
        $path = "$dir/ff-$stamp.sqlite.gz";
        $gz = gzopen($path, 'wb6');
        $in = fopen($tmp, 'rb');
        while (!feof($in)) gzwrite($gz, fread($in, 1 << 20));
        fclose($in); gzclose($gz); @unlink($tmp);
    } else {
        $pdo = db();
        $path = "$dir/ff-$stamp.sql.gz";
        $gz = gzopen($path, 'wb6');
        gzwrite($gz, "-- Farrell Fitness backup, " . date('c') . "\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n");
        foreach ($pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN) as $table) {
            $create = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_NUM)[1];
            gzwrite($gz, "DROP TABLE IF EXISTS `$table`;\n$create;\n");
            $st = $pdo->query("SELECT * FROM `$table`");
            $batch = [];
            while ($row = $st->fetch(PDO::FETCH_NUM)) {
                $batch[] = '(' . implode(',', array_map(fn($v) => sql_quote($pdo, $v), $row)) . ')';
                if (count($batch) >= 200) { gzwrite($gz, "INSERT INTO `$table` VALUES " . implode(",\n", $batch) . ";\n"); $batch = []; }
            }
            if ($batch) gzwrite($gz, "INSERT INTO `$table` VALUES " . implode(",\n", $batch) . ";\n");
            gzwrite($gz, "\n");
        }
        gzwrite($gz, "SET FOREIGN_KEY_CHECKS = 1;\n");
        gzclose($gz);
    }
    chmod($path, 0600);
    backup_prune();
    db_meta_set('last_backup_at', (string) time());
    foreach (backup_list() as $b) if ($b['name'] === basename($path)) return $b;
    return ['name' => basename($path)];
}

function backup_prune(): void {
    $keep = [];
    $cut = date('Y-m-d', strtotime('-' . BACKUP_KEEP_DAYS . ' days'));
    $monthCut = date('Y-m', strtotime('first day of -' . BACKUP_KEEP_MONTHS . ' months'));
    $firstOfMonth = [];
    foreach (array_reverse(backup_list()) as $b) { // oldest first
        $mo = substr($b['date'], 0, 7);
        if (!isset($firstOfMonth[$mo])) $firstOfMonth[$mo] = $b['name'];
    }
    foreach (backup_list() as $b) {
        $mo = substr($b['date'], 0, 7);
        if ($b['date'] >= $cut || ($mo >= $monthCut && $firstOfMonth[$mo] === $b['name'])) $keep[$b['name']] = true;
    }
    foreach (backup_list() as $b) if (empty($keep[$b['name']])) @unlink(backup_dir() . '/' . $b['name']);
}

/** Small key/value store in the meta table. */
function db_meta_get(string $k): ?string { $v = q_val('SELECT v FROM meta WHERE k = ?', [$k]); return $v === null ? null : (string) $v; }
function db_meta_set(string $k, string $v): void { db_upsert('meta', ['k' => $k], ['v' => $v]); }

/** Runs from the cron tick: one backup a day, after 3 am local time. */
function backup_if_due(): ?array {
    if ((int) date('G') < 3) return null;
    $last = backup_list()[0] ?? null;
    if ($last && $last['date'] === today()) return null;
    return backup_run();
}

function route_backups(int $uid, string $m) {
    $list = backup_list();
    return ['backups' => array_slice($list, 0, 40), 'count' => count($list),
        'nightly' => count(array_filter($list, fn($b) => $b['date'] >= date('Y-m-d', strtotime('-' . BACKUP_KEEP_DAYS . ' days')))),
        'last' => $list[0] ?? null, 'driver' => config()['db']['driver'] ?? 'mysql'];
}

function route_backups_run(int $uid, string $m) {
    if ($m !== 'POST') fail(405, 'Use POST');
    $b = backup_run();
    return ['backup' => $b] + route_backups($uid, 'GET');
}

function route_backups_download(int $uid, string $m) {
    $name = (string) param('name', '');
    if ($name === 'latest') $name = backup_list()[0]['name'] ?? '';
    if (!preg_match('/^ff-\d{4}-\d{2}-\d{2}-\d{4}\.(sql|sqlite)\.gz$/', $name)) fail(404, 'Backup not found');
    $path = backup_dir() . "/$name";
    if (!is_file($path)) fail(404, 'Backup not found');
    header('Content-Type: application/gzip');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: no-store');
    readfile($path);
    exit;
}

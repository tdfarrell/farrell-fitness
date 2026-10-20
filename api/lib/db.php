<?php
// Database access + schema. Works with MySQL/MariaDB (Bluehost) and SQLite (local testing).

function config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $path = (PHP_SAPI === 'cli' && getenv('FF_CONFIG')) ? getenv('FF_CONFIG') : __DIR__ . '/../config.php';
        if (!file_exists($path)) {
            throw new RuntimeException('Not installed: api/config.php is missing. Open /install.php.');
        }
        $cfg = require $path;
        date_default_timezone_set($cfg['timezone'] ?? 'UTC');
    }
    return $cfg;
}

function db_connect(array $c): PDO {
    if (($c['driver'] ?? 'mysql') === 'sqlite') {
        $dir = dirname($c['sqlite_path']);
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        $pdo = new PDO('sqlite:' . $c['sqlite_path']);
        $pdo->exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    } else {
        $dsn = "mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4";
        $pdo = new PDO($dsn, $c['user'], $c['pass']);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    return $pdo;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) $pdo = db_connect(config()['db']);
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}
function q_all(string $sql, array $p = []): array { return q($sql, $p)->fetchAll(); }
function q_one(string $sql, array $p = []): ?array { $r = q($sql, $p)->fetch(); return $r === false ? null : $r; }
function q_val(string $sql, array $p = []) { $r = q($sql, $p)->fetchColumn(); return $r === false ? null : $r; }

function db_insert(string $table, array $data): int {
    $cols = array_keys($data);
    $sql = "INSERT INTO $table (" . implode(',', $cols) . ") VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ")";
    q($sql, array_values($data));
    return (int) db()->lastInsertId();
}

function db_update(string $table, array $data, array $where): int {
    $set = implode(',', array_map(fn($c) => "$c = ?", array_keys($data)));
    $w = implode(' AND ', array_map(fn($c) => "$c = ?", array_keys($where)));
    return q("UPDATE $table SET $set WHERE $w", array_merge(array_values($data), array_values($where)))->rowCount();
}

/** Portable upsert: $key columns identify the row. Returns the row id if the table has one. */
function db_upsert(string $table, array $key, array $data) {
    $w = implode(' AND ', array_map(fn($c) => "$c = ?", array_keys($key)));
    $existing = q_one("SELECT * FROM $table WHERE $w", array_values($key));
    if ($existing) {
        if ($data) db_update($table, $data, $key);
        return $existing['id'] ?? null;
    }
    return db_insert($table, array_merge($key, $data));
}

function schema_sql(string $driver): array {
    $pk = $driver === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $tail = $driver === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    $t = [
        "users (
            id $pk,
            username VARCHAR(80) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            settings TEXT,
            created_at INT NOT NULL
        )",
        "auth_tokens (
            id $pk,
            user_id INT NOT NULL,
            selector VARCHAR(32) NOT NULL UNIQUE,
            validator_hash VARCHAR(64) NOT NULL,
            expires_at INT NOT NULL
        )",
        "login_attempts (
            id $pk,
            ip VARCHAR(64) NOT NULL,
            ts INT NOT NULL
        )",
        "foods (
            id $pk,
            user_id INT NOT NULL,
            source VARCHAR(16) NOT NULL,
            source_id VARCHAR(64) NOT NULL,
            name VARCHAR(255) NOT NULL,
            brand VARCHAR(255),
            barcode VARCHAR(32),
            kcal DOUBLE NOT NULL DEFAULT 0,
            protein DOUBLE NOT NULL DEFAULT 0,
            carbs DOUBLE NOT NULL DEFAULT 0,
            fat DOUBLE NOT NULL DEFAULT 0,
            fiber DOUBLE,
            sugar DOUBLE,
            sodium DOUBLE,
            portions TEXT,
            recipe TEXT,
            archived INT NOT NULL DEFAULT 0,
            use_count INT NOT NULL DEFAULT 0,
            last_used_at INT,
            created_at INT NOT NULL,
            UNIQUE (user_id, source, source_id)
        )",
        "diary_entries (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            meal VARCHAR(32) NOT NULL,
            food_id INT,
            name VARCHAR(255) NOT NULL,
            brand VARCHAR(255),
            grams DOUBLE,
            quantity DOUBLE NOT NULL DEFAULT 1,
            portion_label VARCHAR(120),
            kcal DOUBLE NOT NULL DEFAULT 0,
            protein DOUBLE NOT NULL DEFAULT 0,
            carbs DOUBLE NOT NULL DEFAULT 0,
            fat DOUBLE NOT NULL DEFAULT 0,
            fiber DOUBLE,
            created_at INT NOT NULL
        )",
        "days (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'auto',
            note TEXT,
            UNIQUE (user_id, date)
        )",
        "weights (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            weight_kg DOUBLE NOT NULL,
            body_fat DOUBLE,
            UNIQUE (user_id, date)
        )",
        "exercises (
            id $pk,
            user_id INT NOT NULL,
            name VARCHAR(120) NOT NULL,
            muscle VARCHAR(60),
            equipment VARCHAR(60),
            archived INT NOT NULL DEFAULT 0
        )",
        "routines (
            id $pk,
            user_id INT NOT NULL,
            name VARCHAR(120) NOT NULL,
            exercise_ids TEXT NOT NULL
        )",
        "workouts (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            name VARCHAR(120) NOT NULL,
            notes TEXT,
            duration_min INT,
            created_at INT NOT NULL
        )",
        "workout_sets (
            id $pk,
            workout_id INT NOT NULL,
            exercise_id INT NOT NULL,
            position INT NOT NULL DEFAULT 0,
            reps INT,
            weight_kg DOUBLE,
            rpe DOUBLE,
            warmup INT NOT NULL DEFAULT 0
        )",
        "checkins (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            expenditure DOUBLE NOT NULL,
            trend_kg DOUBLE,
            kcal INT NOT NULL,
            protein INT NOT NULL,
            carbs INT NOT NULL,
            fat INT NOT NULL,
            detail TEXT,
            UNIQUE (user_id, date)
        )",
        "whoop_tokens (
            id $pk,
            user_id INT NOT NULL UNIQUE,
            whoop_user_id VARCHAR(32),
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            expires_at INT NOT NULL,
            last_sync_at INT
        )",
        "whoop_daily (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            cycle_id VARCHAR(40),
            strain DOUBLE,
            kcal DOUBLE,
            avg_hr INT,
            max_hr INT,
            recovery INT,
            hrv DOUBLE,
            rhr INT,
            spo2 DOUBLE,
            skin_temp DOUBLE,
            sleep_perf INT,
            sleep_eff DOUBLE,
            sleep_consistency INT,
            sleep_hours DOUBLE,
            sleep_need_hours DOUBLE,
            sleep_light DOUBLE,
            sleep_deep DOUBLE,
            sleep_rem DOUBLE,
            resp_rate DOUBLE,
            UNIQUE (user_id, date)
        )",
        "whoop_workouts (
            id $pk,
            user_id INT NOT NULL,
            whoop_id VARCHAR(40) NOT NULL,
            date VARCHAR(10) NOT NULL,
            sport VARCHAR(80),
            start_at VARCHAR(30),
            end_at VARCHAR(30),
            strain DOUBLE,
            kcal DOUBLE,
            avg_hr INT,
            max_hr INT,
            UNIQUE (user_id, whoop_id)
        )",
    ];
    $sql = array_map(fn($x) => "CREATE TABLE IF NOT EXISTS $x$tail", $t);
    $idx = [
        'diary_user_date' => 'diary_entries (user_id, date)',
        'workouts_user_date' => 'workouts (user_id, date)',
        'sets_workout' => 'workout_sets (workout_id)',
        'foods_barcode' => 'foods (user_id, barcode)',
    ];
    foreach ($idx as $name => $on) {
        $sql[] = $driver === 'sqlite' ? "CREATE INDEX IF NOT EXISTS $name ON $on" : "CREATE INDEX $name ON $on";
    }
    return $sql;
}

function run_schema(PDO $pdo, string $driver): void {
    foreach (schema_sql($driver) as $s) {
        try { $pdo->exec($s); }
        catch (PDOException $e) {
            // MySQL has no CREATE INDEX IF NOT EXISTS; ignore "duplicate key name".
            if (stripos($s, 'CREATE INDEX') === 0 && str_contains($e->getMessage(), 'Duplicate')) continue;
            throw $e;
        }
    }
}

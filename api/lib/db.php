<?php
// Database access + schema. Works with MySQL/MariaDB (Bluehost) and SQLite (local testing).

function config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $path = ((PHP_SAPI === 'cli' || PHP_SAPI === 'cli-server') && getenv('FF_CONFIG')) ? getenv('FF_CONFIG') : __DIR__ . '/../config.php';
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
        "meta (
            k VARCHAR(40) NOT NULL PRIMARY KEY,
            v VARCHAR(255)
        )",
        "meal_plans (
            id $pk,
            user_id INT NOT NULL,
            name VARCHAR(80) NOT NULL,
            items TEXT NOT NULL,
            position INT NOT NULL DEFAULT 0,
            updated_at INT NOT NULL
        )",
        "cardio (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            start_time VARCHAR(5),
            activity VARCHAR(40) NOT NULL,
            duration_s INT,
            distance_m DOUBLE,
            avg_hr INT,
            max_hr INT,
            elevation_m DOUBLE,
            effort INT,
            kcal DOUBLE,
            reps INT,
            notes TEXT,
            whoop_id VARCHAR(40),
            created_at INT NOT NULL
        )",
        "health_items (
            id $pk,
            user_id INT NOT NULL,
            name VARCHAR(120) NOT NULL,
            dose VARCHAR(80),
            kind VARCHAR(16) NOT NULL DEFAULT 'supplement',
            time_of_day VARCHAR(16) NOT NULL DEFAULT 'morning',
            supply INT,
            active INT NOT NULL DEFAULT 1,
            position INT NOT NULL DEFAULT 0,
            created_at INT NOT NULL
        )",
        "health_doses (
            id $pk,
            user_id INT NOT NULL,
            item_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            taken_at INT NOT NULL,
            UNIQUE (item_id, date)
        )",
        "labs (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            marker VARCHAR(80) NOT NULL,
            value DOUBLE NOT NULL,
            unit VARCHAR(24),
            ref_low DOUBLE,
            ref_high DOUBLE,
            note VARCHAR(255)
        )",
        "glucose (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            time VARCHAR(5),
            mg_dl DOUBLE NOT NULL,
            context VARCHAR(24),
            note VARCHAR(255),
            created_at INT NOT NULL
        )",
        "measurements (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            kind VARCHAR(24) NOT NULL,
            value DOUBLE NOT NULL,
            value2 DOUBLE,
            note VARCHAR(255),
            UNIQUE (user_id, date, kind)
        )",
        "habits (
            id $pk,
            user_id INT NOT NULL,
            name VARCHAR(80) NOT NULL,
            slot VARCHAR(16) NOT NULL DEFAULT 'day',
            kind VARCHAR(16) NOT NULL DEFAULT 'check',
            target DOUBLE,
            active INT NOT NULL DEFAULT 1,
            position INT NOT NULL DEFAULT 0,
            created_at INT NOT NULL
        )",
        "habit_logs (
            id $pk,
            user_id INT NOT NULL,
            habit_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            done INT NOT NULL DEFAULT 0,
            value DOUBLE,
            UNIQUE (habit_id, date)
        )",
        "journal (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            mood INT,
            energy INT,
            stress INT,
            body TEXT,
            tags TEXT,
            context TEXT,
            updated_at INT NOT NULL,
            UNIQUE (user_id, date)
        )",
        // Added in schema version 3.
        "med_doses (
            id $pk,
            user_id INT NOT NULL,
            item_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            slot INT NOT NULL DEFAULT 0,
            taken_at INT NOT NULL,
            UNIQUE (item_id, date, slot)
        )",
        "progress_photos (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            pose VARCHAR(8) NOT NULL,
            file VARCHAR(80) NOT NULL,
            thumb VARCHAR(80),
            width INT,
            height INT,
            created_at INT NOT NULL,
            UNIQUE (user_id, date, pose)
        )",
        "push_subscriptions (
            id $pk,
            user_id INT NOT NULL,
            endpoint_hash VARCHAR(64) NOT NULL UNIQUE,
            endpoint TEXT NOT NULL,
            p256dh VARCHAR(160) NOT NULL,
            auth VARCHAR(48) NOT NULL,
            device VARCHAR(120),
            created_at INT NOT NULL,
            last_ok_at INT
        )",
        "reminder_log (
            id $pk,
            user_id INT NOT NULL,
            rkey VARCHAR(80) NOT NULL,
            date VARCHAR(10) NOT NULL,
            sent_at INT NOT NULL,
            UNIQUE (user_id, rkey, date)
        )",
        "sync_keys (
            id $pk,
            user_id INT NOT NULL,
            key_hash VARCHAR(64) NOT NULL UNIQUE,
            created_at INT NOT NULL,
            last_used_at INT,
            uses INT NOT NULL DEFAULT 0
        )",
        // Added in schema version 4.
        "drinks (
            id $pk,
            user_id INT NOT NULL,
            date VARCHAR(10) NOT NULL,
            kind VARCHAR(16) NOT NULL,
            amount DOUBLE NOT NULL,
            label VARCHAR(60),
            kcal DOUBLE,
            diary_entry_id INT,
            logged_at INT NOT NULL
        )",
    ];
    $sql = array_map(fn($x) => "CREATE TABLE IF NOT EXISTS $x$tail", $t);
    $idx = [
        'diary_user_date' => 'diary_entries (user_id, date)',
        'workouts_user_date' => 'workouts (user_id, date)',
        'sets_workout' => 'workout_sets (workout_id)',
        'foods_barcode' => 'foods (user_id, barcode)',
        'cardio_user_date' => 'cardio (user_id, date)',
        'doses_user_date' => 'health_doses (user_id, date)',
        'labs_user_date' => 'labs (user_id, date)',
        'glucose_user_date' => 'glucose (user_id, date)',
        'habit_logs_user_date' => 'habit_logs (user_id, date)',
        'med_doses_user_date' => 'med_doses (user_id, date)',
        'reminder_log_date' => 'reminder_log (date)',
        'drinks_user_date' => 'drinks (user_id, date)',
    ];
    foreach ($idx as $name => $on) {
        $sql[] = $driver === 'sqlite' ? "CREATE INDEX IF NOT EXISTS $name ON $on" : "CREATE INDEX $name ON $on";
    }
    return $sql;
}

// Bump when the schema changes. Existing databases are brought up to date on the next request.
const SCHEMA_VERSION = 4;

/** Columns added after the first release: [table, column, type]. */
function added_columns(): array {
    return [
        ['whoop_daily', 'step_count', 'INT'],
        ['whoop_workouts', 'distance_m', 'DOUBLE'],
        ['whoop_workouts', 'altitude_gain_m', 'DOUBLE'],
        ['whoop_workouts', 'zones', 'TEXT'],
        ['whoop_workouts', 'percent_recorded', 'DOUBLE'],
        // Version 3: medication schedules, and where a weigh-in came from.
        ['health_items', 'frequency', "VARCHAR(16) NOT NULL DEFAULT 'daily'"],
        ['health_items', 'schedule', 'TEXT'],
        ['health_items', 'remind', 'INT NOT NULL DEFAULT 1'],
        ['health_items', 'refill_remind', 'INT NOT NULL DEFAULT 1'],
        ['weights', 'source', 'VARCHAR(16)'],
        // Version 4: micronutrients, and more than one user.
        ['foods', 'micros', 'TEXT'],
        ['diary_entries', 'micros', 'TEXT'],
        ['users', 'display_name', 'VARCHAR(80)'],
        ['users', 'is_admin', 'INT NOT NULL DEFAULT 0'],
        ['users', 'disabled', 'INT NOT NULL DEFAULT 0'],
        ['users', 'must_change_pw', 'INT NOT NULL DEFAULT 0'],
        ['users', 'last_seen_at', 'INT'],
        ['users', 'session_epoch', 'INT NOT NULL DEFAULT 0'],
    ];
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
    foreach (added_columns() as [$table, $col, $type]) {
        try { $pdo->exec("ALTER TABLE $table ADD COLUMN $col $type"); }
        catch (PDOException $e) {
            // Already there (fresh install, or a migration that ran before).
            if (stripos($e->getMessage(), 'duplicate') !== false) continue;
            throw $e;
        }
    }
    $st = $pdo->prepare('SELECT v FROM meta WHERE k = ?');
    $st->execute(['schema_version']);
    $had = $st->fetchColumn();
    migrate_data($pdo, $had === false ? 1 : (int) $had);
    if ($had === false) $pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?)')->execute(['schema_version', (string) SCHEMA_VERSION]);
    else $pdo->prepare('UPDATE meta SET v = ? WHERE k = ?')->execute([(string) SCHEMA_VERSION, 'schema_version']);
}

/** Moves data into new shapes. Runs once, after the tables and columns exist. */
function migrate_data(PDO $pdo, int $from): void {
    if ($from < 3) {
        // Doses were one per item per day; now each scheduled dose has a slot. Old rows become slot 0.
        $exists = $pdo->query("SELECT COUNT(*) FROM med_doses")->fetchColumn();
        if ((int) $exists === 0) {
            try {
                $pdo->exec('INSERT INTO med_doses (user_id, item_id, date, slot, taken_at) SELECT user_id, item_id, date, 0, taken_at FROM health_doses');
            } catch (PDOException $e) { /* no old doses table on a fresh install */ }
        }
    }
    if ($from < 4) {
        // Before version 4 there was one user. They become the first admin.
        $first = $pdo->query('SELECT MIN(id) FROM users')->fetchColumn();
        $admins = (int) $pdo->query('SELECT COUNT(*) FROM users WHERE is_admin = 1')->fetchColumn();
        if ($first && !$admins) $pdo->prepare('UPDATE users SET is_admin = 1 WHERE id = ?')->execute([(int) $first]);
    }
}

/** Brings an existing database up to SCHEMA_VERSION. Cheap when it's already current. */
function ensure_schema(): void {
    try { $v = (int) q_val("SELECT v FROM meta WHERE k = 'schema_version'"); }
    catch (PDOException $e) { $v = 1; } // meta table doesn't exist yet: first release
    if ($v >= SCHEMA_VERSION) return;
    run_schema(db(), config()['db']['driver'] ?? 'mysql');
}

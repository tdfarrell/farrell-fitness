<?php
// Copy this file to config.php (install.php does it for you) and fill in the values.
// config.php is blocked from web access by api/.htaccess.
return [
    // Database. On Bluehost: cPanel > MySQL Databases. Host is almost always "localhost".
    'db' => [
        'driver'   => 'mysql',          // 'mysql' on Bluehost, 'sqlite' for local testing
        'host'     => 'localhost',
        'name'     => 'cpaneluser_fitness',
        'user'     => 'cpaneluser_fit',
        'pass'     => 'CHANGE_ME',
        'sqlite_path' => __DIR__ . '/../data/app.sqlite',
    ],

    // Public URL of the app, no trailing slash, e.g. https://fit.example.com or https://example.com/fitness
    'base_url' => 'https://fit.example.com',

    // Your timezone; used to decide what "today" is for WHOOP cycles and check-ins.
    'timezone' => 'America/New_York',

    // USDA FoodData Central key (free): https://fdc.nal.usda.gov/api-key-signup
    'usda_api_key' => 'DEMO_KEY',

    // WHOOP developer app: https://developer.whoop.com  (Redirect URL = base_url + /api/?r=whoop/callback)
    'whoop' => [
        'client_id'     => '',
        'client_secret' => '',
    ],

    // Random string used by the cron URL, e.g. output of: openssl rand -hex 24
    'cron_secret' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',
];

# Farrell Fitness

A personal nutrition, weight and training tracker that installs on your phone as an app and has a full dashboard on desktop. It estimates your real energy expenditure from what you eat and how your weight changes, and sets weekly calorie and macro targets from it, the way MacroFactor does. It also pulls in WHOOP recovery, HRV, sleep and strain.

**Runs on:** PHP 8.1+ and MySQL/MariaDB (any cPanel shared host, including Bluehost). No build step and no Node on the server.

## What's in it

- **Food log.** Search the USDA FoodData Central database (basic foods and branded products), scan barcodes (Open Food Facts, then USDA), create your own foods and recipes, quick-add calories, copy meals from yesterday, and mark days as fasted or incomplete.
- **Weight.** Daily weigh-ins with a smoothed trend line.
- **Adaptive expenditure.** Every day, the last three weeks of logged intake are compared with how fast your weight is changing (about 7,700 kcal per kg). The estimate starts from a formula and moves toward what your data says, gradually.
- **Weekly check-ins.** On your chosen day, new targets are proposed from your expenditure, your goal rate and your macro preferences. You apply them or keep the current ones. A manual mode lets you set targets yourself.
- **Training.** Routines, a set-by-set logger with last-time values, warm-up sets, a rest timer, estimated 1-rep-max history per exercise, and WHOOP workouts alongside.
- **WHOOP.** OAuth connection, hourly sync of recovery, HRV, resting heart rate, SpO2, skin temperature, sleep stages and need, day strain, WHOOP calories and workouts.
- **App behavior.** Installable PWA, works offline (writes made offline are queued and synced later), light and dark themes, stays signed in for 180 days.

## Setting it up on Bluehost

### 1. Prepare the hosting account

1. **Pick the address.** A subdomain such as `fit.yourdomain.com` is simplest. In cPanel (Bluehost's portal may list it under Advanced), open **Domains** and create the subdomain. Note its document root folder, for example `public_html/fit`.
2. **Turn on HTTPS.** Make sure the subdomain has an SSL certificate (cPanel > SSL/TLS Status; AutoSSL usually covers it within a few minutes). The installable app and secure cookies need HTTPS.
3. **Set PHP 8.1 or newer.** cPanel > MultiPHP Manager > select the domain > PHP 8.1, 8.2 or 8.3.
4. **Create the database.** cPanel > MySQL Databases: create a database, create a user with a strong password, then add the user to the database with **All Privileges**. Write down the full names, which include your cPanel prefix (for example `cpuser_fitness`).

### 2. Connect GitHub to the server (automatic deploys)

1. cPanel > **FTP Accounts** > create an account, for example `deploy@yourdomain.com`, with its **Directory** set to the app folder (for example `public_html/fit`). Use a long password.
2. Click **Configure FTP Client** next to the account to see the FTP server name (often `ftp.yourdomain.com`).
3. In GitHub, open the repo > **Settings > Secrets and variables > Actions** and add:

   | Secret | Value |
   |---|---|
   | `FTP_SERVER` | the FTP server name |
   | `FTP_USERNAME` | `deploy@yourdomain.com` |
   | `FTP_PASSWORD` | that account's password |
   | `FTP_SERVER_DIR` | `./` if the FTP account's directory is already the app folder, otherwise the path ending in `/`, such as `public_html/fit/` |

4. Open the **Actions** tab, choose **Test and deploy to Bluehost**, and click **Run workflow** (or push any commit to `main`). The tests run first, and the upload only happens if they pass. Later deploys upload only changed files.

Your secrets never go in the repo. `api/config.php` is created on the server by the installer and is excluded from both git and the deploy.

### 3. Run the installer

Open `https://fit.yourdomain.com/install.php` and fill in:

- the database name, user and password from step 1;
- the app address and your time zone;
- your **USDA API key** (free, emailed instantly at <https://fdc.nal.usda.gov/api-key-signup>). Without it, a shared demo key allows only about 30 searches an hour;
- your **WHOOP client ID and secret** (next section); you can leave these blank and add them to `api/config.php` later;
- your username and password.

The installer creates the tables, your account and a starter exercise library with four routines, then locks itself. Delete `install.php` from the server afterwards; it will come back on the next deploy but stays locked.

### 4. Create the WHOOP connection

1. Sign in at <https://developer.whoop.com> with your WHOOP account and create an app in the Developer Dashboard.
2. Set the **Redirect URL** to `https://fit.yourdomain.com/api/?r=whoop/callback` (the installer and the Settings screen both show the exact value).
3. Select the scopes `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile` and `read:body_measurement`. The app also requests `offline` so it can refresh access without you signing in again.
4. Copy the client ID and secret into the installer, or into `api/config.php` under `whoop`.
5. In the app, open **Settings > WHOOP > Connect WHOOP**. The first sync pulls 90 days.

### 5. Hourly WHOOP sync

cPanel > **Cron Jobs** > Once per hour, with the command the installer shows you:

```
curl -s "https://fit.yourdomain.com/api/?r=cron/whoop&key=YOUR_CRON_SECRET" >/dev/null
```

or, without curl:

```
php /home/CPANELUSER/public_html/fit/cron/whoop-sync.php
```

The app also syncs when you press **Sync now**.

### 6. Put it on your phone

- **iPhone:** open the address in Safari > Share > **Add to Home Screen**.
- **Android:** open it in Chrome > menu > **Install app**.
- **Desktop:** Chrome and Edge show an install icon in the address bar; or just bookmark it. Screens 1024 px and wider get the sidebar dashboard.

## Day-to-day tips

- Weigh in each morning; the trend smooths daily water swings.
- Log everything you eat. If you know a day is incomplete, open the food log for that day > **Day options** > **Leave out**, so it doesn't skew expenditure. Mark fasting days as **Fasted**.
- The estimate needs about three weeks of data to settle. If you already know your expenditure from MacroFactor, enter it under **Settings > About you > Starting expenditure** to skip the warm-up.
- **Settings > Download all my data** exports everything as JSON.

## Local development

```
cp api/config.sample.php api/config.php   # or run install.php and choose SQLite
php -S 127.0.0.1:8080 -t .
php tests/seed_demo.php                    # optional: 10 weeks of sample data (SQLite only)
node tests/tdee.test.mjs                   # expenditure engine simulations
php tests/parsers_test.php                 # USDA / Open Food Facts / WHOOP parsing
```

## Layout

```
index.html, sw.js, manifest.webmanifest   app shell, offline support, install metadata
assets/css/app.css                         design tokens (light and dark) and components
assets/js/tdee.js                          adaptive expenditure and target math
assets/js/views/                           Today, Food, Weight, Train, Progress, WHOOP, Settings
api/index.php                              JSON API router (/api/?r=route)
api/lib/                                   database, auth, foods (USDA/OFF), WHOOP sync
install.php                                one-time setup
cron/whoop-sync.php                        command-line sync for cron
.github/workflows/deploy.yml               test, then FTPS deploy on push to main
```

## Security notes

- Passwords are hashed with PHP's `password_hash`. Sign-in is rate-limited per IP.
- Sessions use HttpOnly, SameSite cookies. The "stay signed in" token is stored hashed and rotated on every use.
- Every write request must carry a custom header, which blocks cross-site form attacks.
- `.htaccess` forces HTTPS and blocks `api/config.php`, `api/lib/`, `data/`, `cron/`, `tests/` and dotfiles from the web.

Fonts: Barlow and Barlow Condensed, SIL Open Font License (`assets/fonts/OFL.txt`).

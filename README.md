# Farrell Fitness

A personal nutrition, training and health tracker that installs on your phone as an app and has a full dashboard on desktop. It estimates your real energy expenditure from what you eat and how your weight changes, and sets weekly calorie and macro targets from it, the way MacroFactor does. It also tracks lifting and cardio, body measurements and progress photos, medications, labs, habits and a journal, pulls in WHOOP recovery, sleep, strain and steps, and sends reminders.

**Runs on:** PHP 8.1+ (with the OpenSSL extension) and MySQL/MariaDB, on any cPanel shared host including Bluehost. No build step, no Composer and no Node on the server.

## What's in it

- **Food.** An overview with what's left today for each macro (fiber included), a trends chart for calories, protein, carbs, fat or fiber, drinks, a month calendar colored by how each day landed against its target, recent days and your most-logged foods. A day-by-day diary with USDA FoodData Central search, barcode scanning (Open Food Facts, then USDA), your own foods and recipes, quick add, copy meals and day status (fasted, left out). Meal plans that check a day against your targets without logging it.
- **Nutrients and Fill my macros.** Vitamins, minerals, fiber, sodium, saturated fat and sugar for each day or a 7-day average, against standard targets for your age and sex or your own. "Fill my macros" suggests one or two of your own foods, in sensible portions, that cover what's left today.
- **Drinks.** Water, caffeine and alcohol counters on Today, the Food overview and the diary (caffeine and alcohol fold up under water), with a caffeine cut-off time and an option to add drink calories to the food log. Insights compare drinks with your sleep, HRV and recovery.
- **Diet phases.** Line up fat loss, diet breaks, a reverse diet, lean gains and maintenance. Each weekly check-in sets targets from the phase you're in.
- **Weight and goal projection.** Daily weigh-ins with a smoothed trend, and a projection of when you'll reach a goal weight at different rates, with the calories each rate means.
- **Adaptive expenditure and weekly check-ins.** The last three weeks of intake are compared with how fast your weight is changing (about 7,700 kcal per kg). On your check-in day, new targets are proposed from the estimate, your goal rate and macro preferences.
- **Training.** An overview with your next scheduled workout, this week planned against done, what's coming up, 12-week trends, a calendar and new records. Routines with planned sets and warm-up ramps, exercises by equipment and type (only lifts count toward volume), a set-by-set logger with last-time values, effort 1 to 10 per set and per session, timed sets for planks, hangs and carries (a hold timer that counts in, switches sides and keeps counting past your target, with added weight when you use it), and a rest timer that alarms (a tone with the app open, a notification on a locked phone). Cardio by where you did it (treadmill, track, road, stationary bike) with pace and heart rate zones, and records for every lift and activity.
- **Stretching and schedule.** A stretch library, stretching routines that can be a warm-up or cool-down for a routine or a cardio activity, and a guided timer that switches sides. A weekly schedule for strength, cardio and stretching (every N weeks, every N days or once), with skips, moves and reminders.
- **Body.** Eleven tape measurements, body fat from a tape estimate (US Navy method), a smart scale or entered by hand, lean and fat mass, and progress photos with a camera that shows a faint outline of your last photo, plus side-by-side and slider comparisons.
- **Health.** Medications and supplements on any schedule (daily, twice or three times a day, weekly, every few days, as needed), with a dose checklist, supply countdown and refill warnings. VO2 max, WHOOP vitals, blood pressure, labs against their reference ranges, and blood sugar.
- **Habits and journal.** A daily checklist that ticks some habits off on its own (steps, sleep, weigh-in, meds, food, journal, water, stretching) and a journal that saves a snapshot of each day.
- **Insights and weekly report.** Patterns across sleep, food, training, recovery and mood, each rated by how much data supports it. A weekly report every Sunday.
- **Reminders.** Push notifications for weighing in, each medication dose, finishing your food log, progress photos, the weekly report, check-ins and scheduled workouts. They skip themselves when the thing is already done.
- **Smart scale sync.** Scales that write to Apple Health (Eufy, Withings, Renpho and others) can send weigh-ins here through an iPhone Shortcut.
- **Backups.** The database is backed up every night; 30 days and 6 monthly copies are kept.
- **More than one person.** Admins add people from **More > Users**. Each person has their own private data and can change their own name, username and password in Settings; admins can reset passwords, pause or delete accounts but can't see anyone else's logs.
- **App behavior.** Installable PWA, works offline (changes made offline sync later), light and dark themes, a back button on every screen (or swipe from the left edge), drag-and-drop reordering everywhere, stays signed in for 180 days.

## Setting it up on Bluehost

### 1. Prepare the hosting account

1. **Pick the address.** A subdomain such as `fit.yourdomain.com` is simplest. In cPanel (Bluehost's portal may list it under Advanced), open **Domains** and create the subdomain. Note its document root folder, for example `public_html/fit`.
2. **Turn on HTTPS.** Make sure the address has an SSL certificate (cPanel > SSL/TLS Status; AutoSSL usually covers it within a few minutes). The installable app, reminders and secure cookies need HTTPS.
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

Your secrets never go in the repo. `api/config.php` is created on the server by the installer and is excluded from both git and the deploy, as are `data/photos/` and `data/backups/`.

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

### 5. The scheduled task (reminders, WHOOP sync, backups)

One cron job does everything on a schedule: it sends reminders that are due, syncs WHOOP about once an hour and makes the nightly backup after 3 am. In cPanel > **Cron Jobs**, add a job that runs **every 15 minutes** (Minute `*/15`, and `*` for hour, day, month and weekday) with the command the installer shows you:

```
curl -s "https://fit.yourdomain.com/api/?r=cron/tick&key=YOUR_CRON_SECRET" >/dev/null
```

or, without curl:

```
php /home/CPANELUSER/public_html/fit/cron/tick.php
```

`YOUR_CRON_SECRET` is `cron_secret` in `api/config.php`. If you already have the old hourly `cron/whoop` job, replace it with this one. **Settings > Reminders and sync** warns you if the task hasn't run in the last 3 hours.

### 6. Put it on your phone

- **iPhone:** open the address in Safari > Share > **Add to Home Screen**.
- **Android:** open it in Chrome > menu > **Install app**.
- **Desktop:** Chrome and Edge show an install icon in the address bar; or just bookmark it. Screens 1024 px and wider get the sidebar dashboard.

### 7. Turn on reminders

Open the app **from the Home Screen icon** (on iPhone, notifications only work in the installed app, iOS 16.4 or later), go to **More > Reminders and sync**, and tap **Turn on reminders**. Allow notifications when asked, then tap **Send a test**. Turn reminders on separately on each device you want them on. Each reminder's time can be changed there; medication reminders use the dose times in each item's schedule. The rest timer's alert on a locked phone and reminders before scheduled workouts use the same notifications, so they need reminders on for that device too (Settings > Rest timer has the alarm's own options). The rest alert is sent by the server when the rest ends, so the host has to let a request keep running for the length of a rest. If it never arrives on a locked phone, the host is probably ending long requests early.

### 8. Add other people (optional)

The account made by the installer is an admin. Open **More > Users**, enter a name and username, and tap **Create user**. The app shows a temporary password once; send it with the username. They choose their own password the first time they sign in. Each person turns on their own reminders and connects their own WHOOP account in Settings. If WHOOP refuses someone, check the app's user limits in the WHOOP developer dashboard.

### 9. Smart scale (optional)

For a scale that syncs to Apple Health, such as Eufy (EufyLife > Me > Apple Health):

1. In the app, **More > Reminders and sync > Smart scale > Set up the Shortcut**. This makes a private sync key and shows it once, with the address to send to.
2. In the iPhone **Shortcuts** app, make a shortcut with these actions:
   - **Find Health Samples** where Type is Weight, sorted by Start Date, Latest First, Limit 1.
   - **Get Details of Health Samples**: Value. Add two more for Unit and Start Date.
   - **Find Health Samples** where Type is Body Fat Percentage, Latest First, Limit 1, then **Get Details**: Value (skip if your scale has no body fat).
   - **Get Contents of URL** with the address. Method POST, Request Body JSON, with fields `key` (Text, your sync key), `weight` (Number), `unit` (Text), `date` (Text, the Start Date) and `body_fat` (Number).
3. In Shortcuts > **Automation**, add a Time of Day automation (for example 9:00 am daily) or App > your scale app > Is Closed, set to Run Immediately.

Running it twice is harmless; each day keeps its newest reading. Reset the key in the app to stop a Shortcut from working.

## Day-to-day tips

- Weigh in each morning; the trend smooths daily water swings.
- Log everything you eat. If a day is incomplete, open it in the food log > **Day options** > **Leave out**, so it doesn't skew expenditure. Mark fasting days as **Fasted**.
- The estimate needs about three weeks of data to settle. If you already know your expenditure from MacroFactor, enter it under **Settings > About you > Starting expenditure**.
- Measure on the same day each week or two, first thing in the morning. Take progress photos in the same spot and light.
- **Settings > Download all my data** exports everything as JSON. Progress photos are listed there; the images stay on the server.

## Restoring a backup

Backups are in `data/backups/` on the server, or download the latest from **More > Reminders and sync > Backups**. They're gzipped SQL files. To restore one, open cPanel > **phpMyAdmin**, select the database, choose **Import** and upload the `.sql.gz` file. It replaces every table with the copy from the backup. Progress photos are files in `data/photos/` and aren't part of the database backup; include that folder if you copy the site elsewhere.

## Local development

```
cp api/config.sample.php api/config.php   # or run install.php and choose SQLite
php -S 127.0.0.1:8080 -t .
php tests/seed_demo.php                    # optional: 10 weeks of sample data (SQLite only)
node tests/tdee.test.mjs                   # expenditure engine simulations
node tests/stats.test.mjs                  # insights, body fat and calendar helpers
node tests/nutrition.test.mjs              # fill my macros, diet phases, nutrient targets, drink insights
php tests/parsers_test.php                 # USDA / Open Food Facts / WHOOP parsing
php tests/api_test.php                     # every API route over HTTP, including database upgrades
php tests/webpush_test.php                 # push encryption, checked by Node's crypto
```

`FF_TEST_MYSQL="host;db;user;pass" php tests/api_test.php` runs the API tests against MySQL or MariaDB (the database is emptied first).

## Layout

```
index.html, sw.js, manifest.webmanifest   app shell, offline support and push notifications, install metadata
assets/css/app.css                         design tokens (light and dark) and components
assets/js/tdee.js                          adaptive expenditure and target math
assets/js/stats.js                         statistics and calendar helpers for Insights and the overviews
assets/js/sortable.js                      drag to reorder (touch, mouse and keyboard)
assets/js/push.js                          turning reminders on and off on a device
assets/js/nutrients.js, fill.js, phases.js nutrient targets, Fill my macros, diet phases
assets/js/nav.js                           back button, in-app history and edge swipe
assets/js/restalarm.js                     rest timer tones and the locked-phone alarm
assets/js/views/                           one file per screen
api/index.php                              JSON API router (/api/?r=route)
api/lib/                                   database, auth, users, foods, nutrients and drinks, WHOOP, health, photos, push, reminders, rest alarm, stretching, schedule, backups, scale sync
install.php                                one-time setup
cron/tick.php                              the scheduled task, for cPanel cron
.github/workflows/deploy.yml               test, then FTPS deploy on push to main
```

## Security notes

- Passwords are hashed with PHP's `password_hash`. Sign-in and scale-sync attempts are rate-limited per IP.
- Every request checks that the account still exists and isn't paused. Resetting a password or signing someone out everywhere ends their open sessions too.
- Sessions use HttpOnly, SameSite cookies. The "stay signed in" token is stored hashed and rotated on every use.
- Every write request from the app must carry a custom header, which blocks cross-site form attacks. The scale endpoint instead requires its own key, stored hashed.
- Progress photos and backups are in `data/`, which the web server never serves; photos go only to their signed-in owner.
- Push messages are encrypted for each device (RFC 8291) and signed with the app's own VAPID key, made on first use.
- `.htaccess` forces HTTPS and blocks `api/config.php`, `api/lib/`, `data/`, `cron/`, `tests/` and dotfiles from the web.

Fonts: Barlow and Barlow Condensed, SIL Open Font License (`assets/fonts/OFL.txt`).

# Deploying Darb to cPanel (darb.aynur.ps)

Darb runs on the Injazat cPanel account (CloudLinux, cPanel "Setup Node.js App" with Passenger, MySQL-compatible
database on `localhost:3306`; MySQL 8 uses the original migrations, while MariaDB 11.4 uses the checked-in
translation wrapper). One Node.js app serves both the API (`/api/v1`) and the Admin site, so the Admin cookie
session (ADR-023) works on one origin. Other projects on the same account are never touched: Darb lives in
`~/darb-app`, its backups in `~/darb-backups`, and its cron lines are tagged `# darb-app`.

## Layout on the server

| Path | What |
| --- | --- |
| `~/darb-app/app.cjs` | Passenger startup file (CommonJS) that imports `app-main.mjs`, which loads the settings, builds `DATABASE_URL` and starts `dist/server.js` |
| `~/darb-app/dist`, `prisma`, `admin` | compiled API, schema + migrations, Admin build (replaced on each deploy) |
| `~/darb-app/ops/` | setup, install, keep-alive, backup and daily-job scripts |
| `~/darb-app/.env` | production settings and secrets (chmod 600, never in git) |
| `~/darb-app/logs/` | backup and job logs; Passenger writes `stderr.log` in the app root |
| `~/nodevenv/darb-app/22` | Node 22 environment and installed packages (managed by CloudLinux) |
| `~/darb-backups/` | daily compressed database dumps, 14 days kept |

## First deploy

1. On the operator PC (repo root, clean checkout of the release commit), with the SSH key
   `~/.ssh/darb_injazat` authorized in cPanel > SSH Access:
   `pwsh -NoProfile -File deploy/cpanel/deploy.ps1 -FirstTime`
   This uploads the release, creates `~/darb-app/.env` with freshly generated secrets, and registers the
   Node.js app for `darb.aynur.ps` (startup file `app.cjs`, Node 22).
2. The owner opens cPanel > Setup Node.js App > darb-app > Environment variables and adds two variables
   (name left, value right, exactly as they are):
   - `DB_PASSWORD` - the password of the MySQL user `aynurzzx_Darb_User`
   - `SMTP_PASSWORD` - the 16-character Gmail App Password of darbapp9@gmail.com
   Passenger gives them to the web app; `ops/env.mjs` also reads them from CloudLinux's
   `~/.cl.selector/node-selector.json` for migrations, backups and cron. If that file does not contain
   them on your account, put the two values in `~/darb-app/.env` instead (the scripts read both).
3. Run `pwsh -NoProfile -File deploy/cpanel/deploy.ps1` (without `-FirstTime`). It installs packages,
   checks the settings, applies migrations, restarts the app, installs the cron jobs and waits for
   `https://darb.aynur.ps/api/v1/health/ready`.
4. Create the first admin in cPanel > Terminal (the password is typed into a hidden prompt):
   `cd ~/darb-app && source ~/nodevenv/darb-app/22/bin/activate && node ops/run.mjs node dist/scripts/createAdmin.js`
5. Sign in at `https://darb.aynur.ps`, then publish the legal texts (Settings > Consents) so sign-up opens.

## Every later deploy

`pwsh -NoProfile -File deploy/cpanel/deploy.ps1` from a clean checkout of the commit to release.

## Cron jobs (installed by ops/install.sh)

- every 5 minutes: `ops/keepalive.sh` — Passenger stops idle apps, which would also stop the API's
  background workers (order expiry, dispatch); a health request keeps it running.
- 02:15 daily: `ops/backup.sh` — `mysqldump` of `aynurzzx_Darb` into `~/darb-backups`.
- 02:40 daily: `ops/jobs.sh` — document expiry reminders, document and receiver-data retention, trust scores.

## Running a command with the production settings

`cd ~/darb-app && source ~/nodevenv/darb-app/22/bin/activate && node ops/run.mjs <command>`
(for example `npx prisma migrate status`). Secrets reach the child process only and are never printed.

# Operations — Backup and Upgrade

Procedures for running Nightforge in production (Roadmap Phase 7).

## What must survive a failure

| Data | Location | Why it matters |
| --- | --- | --- |
| Artifacts | `.nightforge/artifacts/` | Contracts, capsules, decision packets, triage records, memory proposals — the audit trail for every autonomous decision. |
| Queue + metrics | Redis (persistence enabled) | In-flight tickets, locks, speed metrics, cost ledger. |
| Configuration | Environment variables / `.env` outside the repo | Secrets and limits. |
| Project configs | `PROJECTS_DIR` (default `/srv/apps`) | Per-project `.nightforge/project.yaml` files. |

## Backup procedure

1. Artifacts (file-level, safe while running):

   ```bash
   tar -czf nightforge-artifacts-$(date +%F).tar.gz .nightforge/artifacts
   ```

2. Redis (queue + metrics):

   ```bash
   redis-cli BGSAVE
   # copy the generated dump.rdb from your Redis data dir
   ```

3. Project configs:

   ```bash
   tar -czf nightforge-projects-$(date +%F).tar.gz "$PROJECTS_DIR"
   ```

Schedule these with cron/systemd timers; keep at least 14 daily snapshots
off-host. Restoring is the inverse: stop Nightforge, unpack artifacts and
project configs, restore the Redis dump, start Nightforge.

## Upgrade procedure

Nightforge treats artifacts as forward-compatible JSON validated by zod
schemas, so upgrades are rolling-safe:

1. Check the current state: `npm run diagnostics` (no `[fail]` lines).
2. Drain the queue: stop creating new tickets, wait until
   `GET /api/dashboard` shows zero active/waiting jobs.
3. Stop the service (`systemctl stop nightforge` or `docker compose down`).
4. Take a backup (procedure above).
5. Pull the new version and install: `git pull && npm ci`.
6. Run the gate before starting: `npm run lint && npm run typecheck && npm test`.
7. Start the service and confirm: `npm run diagnostics` plus one manual
   `GET /health` against the server.
8. Watch the first real ticket end-to-end; failures appear in triage records
   immediately.

Rollback: stop, restore the backup, check out the previous tag, restart.

## systemd

`ops/nightforge.service` runs the built server (`npm run build` first).
Set all secrets in the unit's `EnvironmentFile`, never in the repo.

## Docker

`docker-compose.yml` provides the one-command installation:

```bash
cp .env.example .env   # fill in secrets
docker compose up -d
npm run diagnostics    # verify
```

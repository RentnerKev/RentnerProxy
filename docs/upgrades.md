# Upgrades, backups and recovery

Use an exact image version in your Compose file and keep the previous version recorded.
Before upgrading, create a backup and keep your Compose file and SMTP `.env` alongside it.
The backup tool briefly stops the appliance and starts it again when finished.

## Create a backup

The tools below require Bun 1.4.2, Docker Compose and a checkout of RentnerProxy.
Run them from the checkout, using the same Compose project name as your installation:

```bash
export RENTNERPROXY_COMPOSE_FILE=/srv/rentnerproxy/docker-compose.yml
bun --env-file=/srv/rentnerproxy/.env scripts/production-backup.ts \
  --project rentnerproxy --output /srv/rentnerproxy-backups
```

Each backup directory contains the PostgreSQL dump, controller state (including certificates)
and application encryption key, with checksums. Administrative audit events are database data
and are included. Redis and proxy request log files are excluded. Keep the complete backup
directory together and store it privately outside the appliance volume.

## Apply an update

Change the image in your installation's Compose file to the desired exact release, then run
these commands from the installation directory:

```bash
docker compose --project-name rentnerproxy pull
docker compose --project-name rentnerproxy up -d
docker compose --project-name rentnerproxy ps
docker compose --project-name rentnerproxy logs --tail 100 rentnerproxy
```

Startup applies pending database migrations and synchronizes built-in roles and permissions.
Concurrent migration processes are serialized, and restarting an updated installation does
not apply its migrations again. Wait for a healthy appliance and check your configured hosts.

The upgrade smoke test starts the published Alpha 1 image with its original schema and real
users, role assignments, proxy and redirect hosts, certificates, trusted CAs and settings.
It upgrades the same volumes, restarts the result, and restores the Alpha 1 backup into a fresh
candidate appliance. HTTP, certificate-verified HTTPS and redirects are checked at each stage.
Separate migration tests cover failed migrations and retry behavior. Backup formats 1 and 2
remain supported by the restore tool; new backups use format 3.

## Recover a failed startup

Keep the existing volumes and backup. Check container status and startup logs first. Correct
database availability, permissions or the reported migration problem before restarting.
Failed transactional migrations roll back; previously completed migrations remain recorded.
If migrations completed but authorization synchronization failed, restarting retries that
synchronization. Do not delete migration journal entries or edit applied migrations.

To return to the previous release, restore the pre-upgrade backup into **fresh volumes** with
that release's exact image. Never start an older image against an already upgraded database.
For example, prepare a separate Compose file with the previous image and use a new project:

```bash
export RENTNERPROXY_COMPOSE_FILE=/srv/rentnerproxy-recovery/docker-compose.yml
bun --env-file=/srv/rentnerproxy/.env scripts/production-restore.ts \
  --project rentnerproxy-recovery \
  --input /srv/rentnerproxy-backups/BACKUP_DIRECTORY --confirm-replace
```

The restore command replaces the target project's data. Stop the original appliance before
starting recovery on the same host ports. Check health and traffic before retiring the old
volumes. Preserve the restored encryption key so encrypted credentials remain usable.

<p align="center">
  <img src="./rentnerproxy-logo.png" alt="RentnerProxy project logo" width="300">
</p>

<h1 align="center">RentnerProxy</h1>

<p align="center">
  <strong>Modern Reverse Proxy Manager</strong>
</p>

<p align="center">
  A self-hosted reverse proxy manager in the earliest stage of development,<br>
  with a Caddy 2.11.4 data plane and an MIT-licensed application.
</p>

<p align="center">
  <a href="https://github.com/RentnerKev/RentnerProxy/actions/workflows/ci.yml"><img src="https://github.com/RentnerKev/RentnerProxy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/RentnerKev/RentnerProxy/actions/workflows/codeql.yml"><img src="https://github.com/RentnerKev/RentnerProxy/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL status"></a>
  <a href="https://www.bestpractices.dev/projects/14354"><img src="https://www.bestpractices.dev/projects/14354/badge"></a>
</p>

> [!IMPORTANT]
> RentnerProxy is still an early development project. Test upgrades and backups before using it
> for critical production traffic.

## Requirements

For the production appliance, use Docker Engine with the Compose plugin. Keep host ports `80`
and `443` available, and allow inbound TCP and UDP traffic on `443` in the host firewall; the
management UI is bound to `127.0.0.1:81`. PostgreSQL and Redis are included, but a public
management origin and an SMTP host, user, password, and sender address are required.

## Installation

Download [`docker-compose.yml`](./docker-compose.yml) and [`.env.production.example`](./.env.production.example)
to an empty folder. Set the Compose image to
`ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.3`, copy the environment template, and set
`RENTNERPROXY_PUBLIC_ORIGIN` and the SMTP values:

```bash
cp .env.production.example .env
docker compose up -d
```

Open `http://localhost:81` and finish first-owner setup with the owner account details. The public
management origin is configured through `RENTNERPROXY_PUBLIC_ORIGIN`, outside the setup flow. Data is
kept in the persistent `rentnerproxy` volume. For remote management, use an SSH
tunnel such as `ssh -L 8181:127.0.0.1:81 user@server` and open `http://localhost:8181`.

### TLS termination in front of managed hosts

When another proxy terminates public HTTPS and forwards HTTP to RentnerProxy, set
`RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS` in the production `.env` to that proxy's direct
socket-peer addresses, for example `192.0.2.10/32,2001:db8::10/128`, then recreate the appliance.
The setting defaults to empty. It accepts at most 128 distinct canonical IPv4/IPv6 CIDRs;
all-address (`/0`) and IPv4-mapped IPv6 ranges are rejected. Use the narrowest stable addresses
available on your deployment network, and configure the terminating proxy to overwrite incoming
`X-Forwarded-Proto` with a single value derived from its actual TLS connection.

Only a configured socket peer carrying exactly one `X-Forwarded-Proto: https` value can bypass
the managed host's HTTP-to-HTTPS redirect. Missing, repeated, comma-separated, or other values
do not bypass it. Direct untrusted clients cannot establish trust with forwarding headers.
Force HTTPS keeps its method-preserving 308 response and public HTTPS port, with
`Cache-Control: no-store`; ACME HTTP-01 challenge handling remains ahead of the redirect.

This data-plane setting is independent of `RENTNERPROXY_TRUST_PROXY_HEADERS`, which governs
the management web application. Existing access-policy IP rules continue to use the direct
peer address. Keep these deployment settings with your Compose configuration when moving or
restoring an appliance; they are not part of database snapshots.

### Upgrade

Create a production backup, set the Compose image to the target release, then pull and recreate:

```bash
docker compose pull
docker compose up -d
```

Backup and restore tools require Bun 1.4.2, Docker Compose, and a repository checkout.
Run them from the checkout with your installation's Compose file and project name:

```bash
export RENTNERPROXY_COMPOSE_FILE=/srv/rentnerproxy/docker-compose.yml
bun --env-file=/srv/rentnerproxy/.env scripts/production-backup.ts \
  --project rentnerproxy --output /srv/rentnerproxy-backups
```

The backup briefly stops the appliance and restarts it afterward. Keep the complete backup
directory, Compose file, and `.env` containing `RENTNERPROXY_PUBLIC_ORIGIN` privately outside the
appliance volume. Backups include the database, controller state, certificates, and encryption key;
the deployment environment is not part of the backup, and Redis and proxy request logs are excluded.
Use the same canonical origin in the restore environment before starting the restored appliance.
Check container health and configured hosts after upgrading.

For rollback, restore the pre-upgrade backup into fresh volumes using the previous exact image.
Prepare a separate Compose file and project; never run an older image against the upgraded database:

```bash
export RENTNERPROXY_COMPOSE_FILE=/srv/rentnerproxy-recovery/docker-compose.yml
bun --env-file=/srv/rentnerproxy/.env scripts/production-restore.ts \
  --project rentnerproxy-recovery \
  --input /srv/rentnerproxy-backups/BACKUP_DIRECTORY --confirm-replace
```

Restore replaces the target project's data. Stop the original appliance before recovery uses
the same host ports, and preserve its volumes until recovery health and traffic are verified.

### Alpha 4 upgrade verification

The production smoke gate upgrades the published, digest-pinned Alpha 3 appliance in place,
checks migrations and existing users, roles, hosts, certificate fingerprints and traffic,
then verifies repeated starts, backup/restore into fresh volumes and failed-restore rollback.
The earlier Alpha 1 upgrade path remains covered.

Certificate recovery tests archive real active and candidate material, ACME accounts,
operation journals, retry state and encrypted DNS credentials using the production archive
filters. They restore the files before restarting the controller with the local CA offline.
The production backup/restore test also compares durable binding jobs, renewal metadata,
event receipts and cursor state, and verifies request decryption with the restored application key.

Run `bun run check`, `bun run certificates:smoke` and `bun run production:smoke` for this gate.
The required Production Smokes CI job also checks proxy forwarding and upstream TLS.
Keep the deployment environment, including `RENTNERPROXY_PUBLIC_ORIGIN`, trusted proxy CIDRs
and TCP/UDP port mappings, alongside the backup: these settings are not stored in PostgreSQL.

## Features

- Caddy 2.11.4 proxy hosts for HTTP, HTTPS, redirects, and WebSockets.
- Certificate import and ACME renewal, including DNS-01 and wildcard certificates.
- Upstream TLS verification with custom trusted CAs.
- Reusable Access Policies with Basic Authentication and IPv4/IPv6 rules.
- Recent proxy request logs and a read-only administrative audit log.
- User and role management with two-factor authentication and passkeys.
- Backup, restore, and automatic configuration recovery after restarts.
- English, German, Spanish, and French language and theme settings.

Development setup and checks are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

### Certificate renewal and retries

ACME certificates become due after two thirds of their actual certificate lifetime. The
controller checks every minute and retains the four global ACME slots and per-certificate
leases. Imported certificates require manual replacement and are never automatically renewed.

Failed operations retain their retry deadline across restarts. Exponential backoff starts at
30 minutes, includes jitter, and is bounded at six hours; a later CA `Retry-After` deadline
takes precedence. Manual retry respects the same deadline. Existing valid certificate material
continues serving traffic after a failed renewal.

CA throttling also pauses new attempts for the shared account in that ACME environment;
staging and production remain separate. Manually importing replacement material does not clear
an outstanding CA cooldown. The attempt counter measures consecutive attempts and resets only
after successful ACME activation.

The controller certificate index records retry scheduling and attempt history alongside the
certificate material. Alpha 3 indexes are read compatibly, including existing `retryAfter`
deadlines. These fields travel with the controller-state backup; retain the entire state
directory and encryption key. This scheduling change requires no database or proxy snapshot
version change. For rollback, restore the pre-upgrade backup rather than opening upgraded
state with an older controller.

### Issued certificates awaiting activation

The controller saves an issued ACME certificate as a durable candidate before attempting
activation. A Caddy load rejection, timeout, failed revision probe, or certificate metadata
write failure keeps that candidate for another activation attempt. Existing active material
continues serving until Caddy confirms the replacement and the active pointer is persisted.
Restart recovery validates the saved material and resumes activation without requesting a
second certificate from the CA.

Certificate details distinguish the active certificate from an issued candidate awaiting
activation. Retrying a candidate only retries activation; CA cooldowns still govern any new
issuance. The controller also retries candidates automatically. DNS proof cleanup is tracked
separately and resumes after restart using only the controller's own saved cleanup intents.

Backups must retain the complete controller certificate directory, including candidate
manifests and material versions, together with the application encryption key. The additive
database migration stores candidate display metadata; the controller remains the owner of
certificate material and activation. The proxy snapshot remains version 7. Rollback requires
restoring the pre-upgrade backup with the previous image.

### Certificate operations and audit history

Certificate issue and renewal work has a durable operation ID and records only observed
steps, from accepted work through challenge handling, issued material, activation, and retry
or failure. Activation retries reuse the operation associated with the issued candidate.
Restart recovery retains those IDs. Certificate details show the current step alongside the
active certificate, scheduling timestamps, last activation, and any pending candidate.
Staging certificates are explicitly marked as test certificates that normal browsers do not trust.

The web server synchronizes certificate metadata and controller events independently of an
open management page. Event IDs are deduplicated when recording system audit entries, so
restarting the web server or replaying a page does not create duplicate audit events. The
controller retains a bounded journal of the latest 10,000 events; older history follows the
web audit retention policy. Cursor resets identify controller replacement, restored state,
or a replay window that has advanced while the web server was offline.

Certificate APIs distinguish a successfully loaded empty store from a store that is not
ready, failed initialization, or is corrupt. An unavailable store returns HTTP 503 and does
not authorize clearing the web database's certificate records. The authenticated internal
status and events endpoints use the same controller token as certificate management.

The additive database migration stores operation and scheduling display metadata and event
synchronization state. Include the database, full controller state directory, and encryption
key in one consistent backup. The proxy snapshot format remains version 7.

### Access-log pagination

Access Logs use the shared table pagination controls with 15 rows by default and page sizes
15, 25, 50 and 100. Filtering and paging run in the controller. Changing filters or page size,
or choosing Refresh, starts again on the first page.

Each result has a short-lived snapshot so new requests and log rotation cannot move rows
between pages. Snapshots expire after two minutes and may be evicted sooner under load; the
UI announces a reset and returns to the first page. Refresh loads the latest logs. The controller
keeps at most eight snapshots within a 16 MiB cache. They are temporary, are lost on restart,
and are excluded from backups. The existing bounded log scan and visible truncation notice
still apply; pagination does not promise access to logs beyond that retained window.

### Certificates requested from proxy hosts

Create and Edit offer a new ACME certificate using the host's domains. The host row also
offers Request certificate. Saving commits the host, pending certificate, and durable job
in one transaction. Repeating the same request returns the original job and certificate.
The web worker continues after the dialog closes or the web process restarts.

A new host remains disabled until its certificate is valid. During replacement, an existing
valid certificate covering the requested domains remains assigned. Before assignment, the
worker checks the full host revision, domain coverage, certificate ownership, and the
requesting user's current permissions. Changed or deleted hosts and revoked permissions
require attention instead of silently applying an outdated request.

The job reports completion only after the controller confirms the current proxy revision.
Activation failures remain visible and can be retried with the existing certificate and
issued candidate. Job request data is encrypted with the application encryption key and
cleared after completion. Include the job table in the same database backup as the host and
certificate records.

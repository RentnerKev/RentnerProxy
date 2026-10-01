<p align="center">
  <img src="./rentnerproxy-logo.png" alt="RentnerProxy project logo" width="300">
</p>

<h1 align="center">RentnerProxy</h1>

<p align="center">
  <strong>Modern self-hosted reverse proxy management powered by Caddy.</strong>
</p>

<p align="center">
  <a href="https://github.com/RentnerKev/RentnerProxy/actions/workflows/ci.yml"><img src="https://github.com/RentnerKev/RentnerProxy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/RentnerKev/RentnerProxy/actions/workflows/codeql.yml"><img src="https://github.com/RentnerKev/RentnerProxy/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL status"></a>
  <a href="https://www.bestpractices.dev/projects/14354"><img src="https://www.bestpractices.dev/projects/14354/badge" alt="OpenSSF Best Practices badge"></a>
  <a href="https://github.com/RentnerKev/RentnerProxy/releases/tag/v1.0.0-alpha.6"><img src="https://img.shields.io/github/v/release/RentnerKev/RentnerProxy?include_prereleases&amp;sort=semver" alt="Current GitHub release"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/RentnerKev/RentnerProxy" alt="MIT license"></a>
</p>

> [!IMPORTANT]
> Public alpha: breaking changes are possible. Back up your data before upgrades.

## Features

- Proxy hosts and redirects with HTTP/2, HTTP/3, and WebSocket support.
- Automatic TLS via ACME (HTTP-01 or Cloudflare DNS-01), wildcard and imported certificates.
- Access policies with Basic Auth, Forward Auth, and IP allow/deny rules; verified HTTPS upstreams.
- CrowdSec protection: managed or external Local API, optional community/Console connection, and a dedicated security dashboard in the development image.
- Users, roles, permissions, TOTP, passkeys, and audit logs.
- Live status and access logs; English, German, Spanish, French, Italian, Portuguese, Dutch, and Polish UI.
- Single-container appliance with Caddy, PostgreSQL, Redis, and a Rust controller.

## Installation

Requirements:

- `linux/amd64` host with Docker Engine and Docker Compose.
- Free ports `80/tcp`, `443/tcp`, and `443/udp`.
- HTTPS management origin and SMTP credentials.

Save this as `docker-compose.yml` (or use the [repository file](docker-compose.yml)):

```yaml
services:
    rentnerproxy:
        image: ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.6
        environment:
            RENTNERPROXY_PUBLIC_ORIGIN: ${RENTNERPROXY_PUBLIC_ORIGIN:?Set RENTNERPROXY_PUBLIC_ORIGIN}
            RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS: ${RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS:-}
            SMTP_FROM: ${SMTP_FROM:?Set SMTP_FROM}
            SMTP_HOST: ${SMTP_HOST:?Set SMTP_HOST}
            SMTP_PASSWORD: ${SMTP_PASSWORD:?Set SMTP_PASSWORD}
            SMTP_PORT: ${SMTP_PORT:-587}
            SMTP_SECURE: ${SMTP_SECURE:-false}
            SMTP_USER: ${SMTP_USER:?Set SMTP_USER}
        ports:
            - '80:8080'
            - '127.0.0.1:81:3000'
            - '443:8443/tcp'
            - '443:8443/udp'
        restart: unless-stopped
        volumes:
            - rentnerproxy:/var/lib/rentnerproxy

volumes:
    rentnerproxy:
```

Create `.env` beside it (see also [`.env.production.example`](.env.production.example)):

```dotenv
RENTNERPROXY_PUBLIC_ORIGIN=https://management.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=rentnerproxy@example.com
SMTP_PASSWORD=replace-me
SMTP_FROM=RentnerProxy <rentnerproxy@example.com>

# Optional: only the direct IP/CIDR of a trusted proxy in front of RentnerProxy.
# RENTNERPROXY_PROXY_TRUSTED_PROXY_CIDRS=192.0.2.10/32
```

Start the appliance:

```bash
docker compose config
docker compose up -d
```

- Complete first-owner setup at `http://localhost:81`. For a remote host, keep port 81 private and use `ssh -L 8181:127.0.0.1:81 user@server`.
- Use the configured HTTPS `RENTNERPROXY_PUBLIC_ORIGIN` for normal access, email links, and passkeys.
- Application data lives in the persistent `rentnerproxy` Docker volume.

## Images and upgrades

- The Compose example pins `v1.0.0-alpha.6`. `v1.0.0-beta.1` has not been published. The current Beta 1 target is a build of the intended code, and its final release commit must pass the [full release compatibility matrix](https://github.com/RentnerKev/RentnerProxy/actions/workflows/release-compatibility.yml) before publication.
- The tested direct source contract for that target is:

| Published source image                           | Direct path to Beta 1 target             |
| ------------------------------------------------ | ---------------------------------------- |
| `ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.1` | Supported direct                         |
| `ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.2` | Supported direct                         |
| `ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.3` | Supported direct                         |
| `ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.4` | Supported direct                         |
| `ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.5` | Supported direct                         |
| `ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.6` | Supported direct; mandatory release gate |

- No staged path is needed for these tested sources. Unlisted or moving images such as `:dev` are unsupported upgrade sources, as are downgrades. The [matrix](scripts/release-compatibility/published-alphas.ts) pins the published image digests.
- Before upgrading, create and retain a pre-upgrade backup outside the appliance volume and record the exact source image tag and digest. Repository [backup](scripts/production-backup.ts) and [restore](scripts/production-restore.ts) tools require a checkout and Bun. Then change to the released target tag, run `docker compose pull`, and run `docker compose up -d`.
- Never start an older image with a database already migrated by a newer image. Rollback means stopping the target, restoring the **pre-upgrade** backup into a fresh volume, and starting the previous **exact** image. Use the tools from that source release for the rollback; current restore tools deliberately reject a newer database on an older target.
- `:dev` is a moving **test image** built manually from `main` by the [Dev Image workflow](https://github.com/RentnerKev/RentnerProxy/actions/workflows/dev-image.yml); it is not a release.
- CrowdSec, Forward Auth, and the NPM importer are **not** in the pinned Alpha 6 image. To test the current implementation, use `ghcr.io/rentnerkev/rentnerproxy:dev` after triggering that workflow.

## CrowdSec (development image)

- **Managed:** local detection and blocking work without a CrowdSec account; community intelligence and Console enrollment are separate opt-ins.
- **External:** connect an existing CrowdSec Local API with a bouncer key.
- **Disabled:** default; existing traffic behavior is unchanged.
- Flags use a bundled country-only MMDB. A mounted GeoLite2 Country file can be selected with the optional `RENTNERPROXY_GEOIP_COUNTRY_DB_PATH` (absolute path; maintain its license and updates).
- Enforcement is fail-open when the selected Local API is unavailable.
- Repository backup v4 includes the managed CrowdSec SQLite database, decisions, local API registration, optional Central API/Console credentials and managed bouncer key. External CrowdSec configuration and its encrypted credential are in PostgreSQL; the external LAPI remains operator owned.

## Forward Auth (development image)

Forward Auth is configured inside an existing Access Policy. Choose a provider preset, enter its full HTTP or HTTPS check endpoint, and select the request credentials and identity response headers needed by that provider. Basic Auth and Forward Auth are mutually exclusive in one policy. An IP rule can be combined with Forward Auth only when **all** checks must pass. The auth check is fail closed: a denied response or unreachable gateway never grants access to the protected upstream. HTTPS auth gateways use normal certificate verification; the endpoint cannot contain credentials or a query string.

Provider reachability is not measured by the Security Dashboard; it reports configured policy counts and settings only.

## More information

- [Architecture](ARCHITECTURE.md) · [Security policy](SECURITY.md) · [Assurance case](ASSURANCE_CASE.md)
- [Release process](RELEASING.md) · [Contributing](CONTRIBUTING.md)
- [Screenshots](screenshots) · [Report a bug](https://github.com/RentnerKev/RentnerProxy/issues/new/choose)

Licensed under [MIT](LICENSE).

## Backup and recovery

Run `bun run backup:production -- --project <project> --output <directory>` with the current checkout and the deployment's Compose environment. The appliance is stopped while PostgreSQL, controller/certificate state, the application encryption key and managed CrowdSec state are captured together, then restarted. Keep the completed backup directory outside the appliance volume. Its manifest records SHA-256 checksums, the source image identity, public origin and trusted proxy CIDRs; the directory is private (0700) and its files are 0600 on Linux. Checksums detect corruption, so retain backups in trusted storage.

Restore with `bun run restore:production -- --project <project> --input <backup> --confirm-replace`. Restore validates the complete manifest and immutable copies of every artifact before stopping the target. It rejects unsafe archive members, incompatible migration history, corrupted databases and application keys that cannot decrypt persisted secrets. Archive extraction uses private staging directories and repairs ownership before startup. The restored desired configuration is reconciled by the controller; verify the appliance health and actual proxy traffic before accepting recovery.

Supported restore sources are current v4 backups into the same current database version, and authentic v3 backups from the pinned published Alpha 4, Alpha 5 and Alpha 6 images into the current target. The [release compatibility matrix](scripts/release-compatibility/run.ts) creates each source backup with that release's own tools, verifies fresh-volume restores and exact-source fresh-volume rollback. Format v1/v2, other releases and downgrades are unsupported; changing a manifest version does not make a backup compatible. Alpha v3 archives predate managed CrowdSec. They initialize CrowdSec on a fresh target and leave any existing CrowdSec directory in place; they cannot recover lost decisions.

Keep the Compose file, image tag/digest, port mappings and deployment environment alongside the backup, including SMTP credentials, canonical public origin and trusted proxy CIDRs. Environment secrets are deliberately absent from the manifest. A v4 restore checks the origin and CIDRs against the target; legacy v3 restores require explicit deployment review with `--allow-deployment-change`. Use that option for an intentional environment change only after reviewing authentication, forwarded-client trust and external integration reachability.

Redis sessions/challenges, request logs, sockets, PID files, locks, temporary files and supervisor status/staging are excluded. Redis-backed flows restart after restore; durable users, sessions, roles, permissions, policies, Basic Auth, Forward Auth, importer history, hosts, redirects, CAs, certificate jobs/events/retries, candidates, ACME accounts and encrypted DNS credentials remain in PostgreSQL/controller state. CrowdSec's SQLite WAL is retained when present, while its shared-memory file is regenerated. Managed startup re-registers the bouncer with a private key and preserves detections and registrations; the LAPI remains bound to loopback.

If restore is interrupted after replacement begins, the persistent journal prevents startup with partially restored state. Stop the appliance if it was manually started and rerun the same backup with `--resume --confirm-replace`. Resume validates that backup again and repeats all replacement steps. Another backup is rejected while the journal is pending. A failure before replacement leaves the running target intact; no automatic destructive retry is attempted. For rollback, use a fresh volume, the pre-upgrade source backup, that source release's restore tools and its exact image digest.

## Runtime reliability checks

With Docker Engine (Linux containers), Docker Compose, Bun 1.4.2, Git history and the repository
dependencies installed, run the isolated synthetic fixture:

```bash
bun run runtime:reliability -- --profile short --source current --report ./runtime-reliability.json
bun run runtime:reliability -- --profile long --source alpha.6 --report ./runtime-reliability-alpha6.json
```

`current` builds the committed `HEAD` snapshot; fixture services are bundled from the exact matching
Git revision. A supplied `--image` for current is accepted only when its OCI revision matches `HEAD`.
`alpha.6` uses the immutable published Alpha 6 image and its pinned historical source. The fixture creates its own private data and credentials. Never supply production
secrets or private data. Cycle admission stops at the first duration or iteration bound: short defaults
to 120 seconds/3 iterations, long to 1800 seconds/120 iterations, both with concurrency 2. The sanitized
JSON records actual workload elapsed time, excluding cold setup, and whether the requested duration was
reached. In-flight cycles finish their bounded commands, so observed duration can exceed the admission
cap. Retain at least eight quiescent samples for trend evidence; a shorter passing run cannot establish
resource stability. These are fixture guards, not production performance benchmarks. The separate
[Runtime Reliability workflow](.github/workflows/runtime-reliability.yml) runs short checks for relevant
PR/main changes and long current/Alpha 6 checks weekly or manually. See [Architecture](ARCHITECTURE.md)
for resource evidence limits and [Releasing](RELEASING.md) for the exact-ref release gate.

Override bounds with `--duration-seconds 30..7200`, `--iterations 1..1000` and `--concurrency 1..8`
(using one integer, not a range). `--seed` accepts a uint32 (default 69) for repeatable fixture choices;
`--capture-resources true|false` controls sampling (default true). CI manual inputs expose the same
controls. Disabling resource capture cannot establish resource stability.

The published Alpha 6 baseline has a known certificate-binding retry defect: an accepted asynchronous
retry can leave the job failed while the controller completes issuance. The fixture records
`alpha6-binding-retry-needs-second-request` in `knownLimitations` only for the verified known state,
then sends one bounded second retry for the same job. This represents an additional operator action;
a passing baseline accounts for that limitation. Current builds must complete after one retry and
report no known limitations. See [Releasing](RELEASING.md) for the required evidence.

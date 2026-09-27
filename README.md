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
- Live status and access logs; English, German, Spanish, and French UI.
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
- Never start an older image with a database already migrated by a newer image. Rollback means stopping the target, restoring the **pre-upgrade** backup into a fresh volume, and starting the previous **exact** image. Backup and restore hardening remains in [#71](https://github.com/RentnerKev/RentnerProxy/issues/71).
- `:dev` is a moving **test image** built manually from `main` by the [Dev Image workflow](https://github.com/RentnerKev/RentnerProxy/actions/workflows/dev-image.yml); it is not a release.
- CrowdSec, Forward Auth, and the NPM importer are **not** in the pinned Alpha 6 image. To test the current implementation, use `ghcr.io/rentnerkev/rentnerproxy:dev` after triggering that workflow.

## CrowdSec (development image)

- **Managed:** local detection and blocking work without a CrowdSec account; community intelligence and Console enrollment are separate opt-ins.
- **External:** connect an existing CrowdSec Local API with a bouncer key.
- **Disabled:** default; existing traffic behavior is unchanged.
- Flags use a bundled country-only MMDB. A mounted GeoLite2 Country file can be selected with the optional `RENTNERPROXY_GEOIP_COUNTRY_DB_PATH` (absolute path; maintain its license and updates).
- Enforcement is fail-open when the selected Local API is unavailable.
- Managed CrowdSec data is not yet in repository backups ([#71](https://github.com/RentnerKev/RentnerProxy/issues/71)); snapshot the Docker volume.

## Forward Auth (development image)

Forward Auth is configured inside an existing Access Policy. Choose a provider preset, enter its full HTTP or HTTPS check endpoint, and select the request credentials and identity response headers needed by that provider. Basic Auth and Forward Auth are mutually exclusive in one policy. An IP rule can be combined with Forward Auth only when **all** checks must pass. The auth check is fail closed: a denied response or unreachable gateway never grants access to the protected upstream. HTTPS auth gateways use normal certificate verification; the endpoint cannot contain credentials or a query string.

Provider reachability is not measured by the Security Dashboard; it reports configured policy counts and settings only.

## More information

- [Architecture](ARCHITECTURE.md) · [Security policy](SECURITY.md) · [Assurance case](ASSURANCE_CASE.md)
- [Release process](RELEASING.md) · [Contributing](CONTRIBUTING.md)
- [Screenshots](screenshots) · [Report a bug](https://github.com/RentnerKev/RentnerProxy/issues/new/choose)

Licensed under [MIT](LICENSE).

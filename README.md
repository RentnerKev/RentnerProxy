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
- Duplicate proxy and redirect hosts into a draft with new domains, using existing creation, certificate and access-policy validation. Proxy copies inherit global HTTP settings; separate per-host Config overrides are not copied.
- Global quick search with Ctrl+K on Windows/Linux and Cmd+K on macOS, plus a mobile search control. Find authorized hosts, certificates, access policies and settings with bounded results and keyboard navigation.
- Automatic TLS via ACME (HTTP-01 or Cloudflare DNS-01), wildcard and imported certificates.
- Access policies with Basic Auth, Forward Auth, and IP allow/deny rules; verified HTTPS upstreams.
- CrowdSec protection: managed or external Local API, optional community/Console connection, and a dedicated security dashboard in the development image.
- Users, roles, permissions, TOTP, passkeys, and audit logs.
- Personal accent colors and light/dark themes; login and public pages retain the default green.
- Live status and access logs; English, German, Spanish, French, Italian, Portuguese, Dutch, and Polish UI.
- Single-container appliance with Caddy, PostgreSQL, Valkey, and a Rust controller.

## Installation

Requirements:

- `linux/amd64` host with Docker Engine and Docker Compose.
- Free ports `80/tcp`, `443/tcp`, and `443/udp`.
- HTTPS management origin and SMTP credentials.

Select a Valkey-based RentnerProxy image with `RENTNERPROXY_IMAGE`. The example uses a local build
from this checkout. Build it before starting the appliance:

```bash
docker build --file docker/production/Dockerfile --tag rentnerproxy:local .
```

Save this as `docker-compose.yml` (or use the [repository file](docker-compose.yml)):

```yaml
services:
    rentnerproxy:
        image: ${RENTNERPROXY_IMAGE:?Set RENTNERPROXY_IMAGE to a Valkey-based RentnerProxy image}
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
        stop_grace_period: 30s
        volumes:
            - rentnerproxy:/var/lib/rentnerproxy

volumes:
    rentnerproxy:
```

Create `.env` beside it (see also [`.env.production.example`](.env.production.example)):

```dotenv
RENTNERPROXY_IMAGE=rentnerproxy:local
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

During restart or recreation, the controller recovers supported persisted proxy snapshots after
preparing CrowdSec, before waiting for PostgreSQL and Valkey. Existing HTTP/HTTPS routes can serve
while those independent services recover; management readiness still waits for the database,
cache and migrations. Fresh installations and unsupported snapshot versions use the safe default
site until the application reconciles their configuration. Replacing a single appliance container
still interrupts its connections and listeners; this startup order does not provide zero downtime.

## Docker images

RentnerProxy images are published to `ghcr.io/rentnerkev/rentnerproxy`.

| Tag       | Channel                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `:latest` | Latest stable release                                                          |
| `:beta`   | Latest beta release                                                            |
| `:alpha`  | Latest alpha release                                                           |
| `:dev`    | Development build from `main` for testing new and potentially unstable changes |

Every release is also published with its exact version tag. Use an exact tag when you want to pin
a specific release, for example:

```text
ghcr.io/rentnerkev/rentnerproxy:v1.0.0
ghcr.io/rentnerkev/rentnerproxy:v1.0.0-beta.1
ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.6
```

Moving channel tags such as `:latest`, `:beta`, and `:alpha` always follow the newest release
in that channel. `:dev` is not a release and may change at any time.

## Screenshots

<p align="center">
  <img src="./screenshots/proxy-hosts.png" alt="Proxy Hosts" width="49%">
  <img src="./screenshots/certificates.png" alt="Certificates" width="49%">
</p>

<p align="center">
  <img src="./screenshots/login.png" alt="Login" width="49%">
  <img src="./screenshots/account-security.png" alt="Account Security" width="49%">
</p>

## More information

- [Architecture](docs/architecture.md) · [Security policy](SECURITY.md) · [Assurance case](docs/security/assurance-case.md)
- [Operations](docs/operations.md) · [Runtime checks](docs/runtime-checks.md)
- [Contributing](.github/CONTRIBUTING.md) · [Report a bug](https://github.com/RentnerKev/RentnerProxy/issues/new/choose)

Licensed under [MIT](LICENSE).

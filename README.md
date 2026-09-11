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

For the production appliance:

- Docker Engine with the Compose plugin.
- Host ports `80` and `443` available; the management UI uses `127.0.0.1:81`.
- SMTP host, user, password, and sender address. PostgreSQL and Redis are included.

## Installation

Download [`docker-compose.yml`](./docker-compose.yml) and [`.env.production.example`](./.env.production.example)
in an empty folder, then run:

```bash
cp .env.production.example .env
# Edit .env with your SMTP settings.
# For Alpha 1, set image: ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.1 in docker-compose.yml.
docker compose up -d
```

Open `http://localhost:81` and finish first-owner setup with the public
management address users will use. Data is kept in the persistent `rentnerproxy` volume. Proxy
traffic uses ports `80` and `443`; for remote management, use an SSH tunnel such as
`ssh -L 8181:127.0.0.1:81 user@server` and open `http://localhost:8181`.

### Release image tags

Published releases select their Docker channel from the version tag:

| GitHub release tag | Moving Docker tag | Exact Docker tag  |
| ------------------ | ----------------- | ----------------- |
| `v1.0.0-alpha.1`   | `:alpha`          | `:v1.0.0-alpha.1` |
| `v1.0.0-beta.1`    | `:beta`           | `:v1.0.0-beta.1`  |
| `v1.0.0`           | `:latest`         | `:v1.0.0`         |

Use `ghcr.io/rentnerkev/rentnerproxy` with the desired tag. Each moving tag follows
the most recently published release in its channel. Exact version tags pin a release.
Alpha and beta releases must be marked as GitHub pre-releases; stable releases must not.
Other prerelease suffixes are rejected. The `:dev` channel is retired; PR preview tags
remain unchanged. Alpha, beta and stable releases each use their own release banner.

### Development installation

Contributors need Bun 1.4.2, Rust 1.98.0, PostgreSQL 18+, and Redis.
Clone the repository, start PostgreSQL and Redis separately, then run:

```bash
cp .env.example .env
# Configure DATABASE_URL, REDIS_URL, SMTP_*, and the local APP_URL.
# Generate APP_ENCRYPTION_KEY below, then copy the result into .env.
bun -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# Set RENTNERPROXY_CONTROLLER_TOKEN for certificate management or non-loopback controller access.
bun install --frozen-lockfile
bun run db:migrate
bun run dev
```

The web app is available at `http://localhost:5173`. The controller's `/health` endpoint can be
healthy without Caddy, but proxy configuration and `/health/ready` require all configured
dependencies. If Redis is not running on `127.0.0.1:6379`, the readiness endpoint returns `503`
after its bounded probe timeout. The local controller also reports proxy configuration as
unavailable until `RENTNERPROXY_CADDY_BIN` points to a usable Caddy binary; this is expected for
UI-only development. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the checks to run before opening a pull request.

## Features

- Caddy 2.11.4 powers proxy hosts for HTTP, HTTPS, redirects, and WebSockets.
- Certificate import and automatic HTTPS certificates with ACME renewal.
- DNS-01 with Cloudflare, including wildcard certificates and mixed wildcard/ordinary names.
- Upstream TLS verification with custom trusted CAs.
- User and role management with two-factor authentication and passkeys.
- Backup, restore, and automatic configuration recovery after restarts.
- English, German, Spanish, and French with theme settings.

### DNS-01 and wildcard certificates

In **Certificates**, request a certificate and select **DNS-01**. Supply the Cloudflare
zone ID and an API token restricted to that zone, with **Zone / Zone / Read** and
**Zone / DNS / Edit** permissions. See Cloudflare's
[API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/).
Every requested name must belong to that zone. DNS-01 proves control through temporary
`_acme-challenge` TXT records and does not require inbound HTTP reachability.
The controller allows 30 seconds for propagation before asking the CA to validate;
if DNS is slower, the operation fails safely and can be retried. Delegated challenge
zones and requests spanning several Cloudflare zones are not supported in this version.

Use `*.example.com` for one subdomain level, such as `app.example.com`. It does not
cover `example.com` or `a.b.example.com`. To cover the apex too, request both
`*.example.com` and `example.com`; every name in that order uses DNS-01. Partial or
nested wildcard labels are rejected. Assign the resulting certificate to matching
Proxy Hosts or Redirect Hosts using their ordinary hostnames. HTTP-01 remains the
default for ordinary certificates.

Provider credentials are encrypted by the controller using `APP_ENCRYPTION_KEY`
(or `APP_ENCRYPTION_KEY_FILE`) and are never returned by certificate APIs. Production
containers provision this key automatically. DNS requests to a remote controller
require HTTPS; HTTP is supported only on loopback. For development, supply the same
32-byte base64 key to the web process and controller. Preserve it across restarts
and restores: losing it prevents DNS-01 renewal. Production backup directories
contain the application encryption key and private certificate material; keep their
private permissions and protect any copies with encryption and restricted access.

The controller retains certificate IDs and host assignments during renewal. Provider
and cleanup failures appear as safe error codes in certificate details and can be
retried through renewal. The deterministic `bun run certificates:smoke` uses a local
DNS/provider fixture and Pebble, including apex/wildcard proofs, HTTPS host matching,
and renewal after restart. It never requests certificates from Let's Encrypt production.

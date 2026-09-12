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
and `443` available; the management UI is bound to `127.0.0.1:81`. PostgreSQL and Redis are
included, but an SMTP host, user, password, and sender address are required.

## Installation

Download [`docker-compose.yml`](./docker-compose.yml) and [`.env.production.example`](./.env.production.example)
to an empty folder. Set the Compose image to
`ghcr.io/rentnerkev/rentnerproxy:v1.0.0-alpha.2`, copy the environment template, and set SMTP values:

```bash
cp .env.production.example .env
docker compose up -d
```

Open `http://localhost:81` and finish first-owner setup with the public management address users
will use. Data is kept in the persistent `rentnerproxy` volume. For remote management, use an SSH
tunnel such as `ssh -L 8181:127.0.0.1:81 user@server` and open `http://localhost:8181`.

### Upgrade

Create a production backup before upgrading, then pull and recreate the service:

```bash
docker compose pull
docker compose up -d
```

See the [upgrade and recovery guide](./docs/upgrades.md) and [release guide](./docs/releases.md).

## Features

- Caddy 2.11.4 proxy hosts for HTTP, HTTPS, redirects, and WebSockets.
- Certificate import and ACME renewal, including DNS-01 and wildcard certificates.
- Upstream TLS verification with custom trusted CAs.
- Reusable Access Policies with Basic Authentication and IPv4/IPv6 rules.
- Recent proxy request logs and a read-only administrative audit log.
- User and role management with two-factor authentication and passkeys.
- Backup, restore, and automatic configuration recovery after restarts.
- English, German, Spanish, and French language and theme settings.

See the [Access Policies guide](./docs/access-policies.md) and [certificate guide](./docs/certificates.md)
for feature-specific usage.

Development setup and checks are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

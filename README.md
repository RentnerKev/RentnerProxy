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
docker compose up -d
```

Open `http://localhost:81` and finish first-owner setup with the public
management address users will use. Data is kept in the persistent `rentnerproxy` volume. Proxy
traffic uses ports `80` and `443`; for remote management, use an SSH tunnel such as
`ssh -L 8181:127.0.0.1:81 user@server` and open `http://localhost:8181`.

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

The web app is available at `http://localhost:5173`. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for the checks to run before opening a pull request.

## Features

- Caddy 2.11.4 powers proxy hosts for HTTP, HTTPS, redirects, and WebSockets.
- Certificate import and automatic HTTPS certificates with ACME renewal.
- Upstream TLS verification with custom trusted CAs.
- User and role management with two-factor authentication and passkeys.
- Backup, restore, and automatic configuration recovery after restarts.
- English, German, Spanish, and French with theme settings.

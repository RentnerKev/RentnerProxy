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

## Current foundation

The repository contains three application components plus its persistence services:

- `web/`: a TanStack Start application with opaque sessions, RBAC, and server-only Drizzle ORM
  access to PostgreSQL.
- `controller/`: an internal Rust health/configuration API managing Caddy and certificates.
- Caddy 2.11.4: the HTTP reverse proxy data plane, loaded through its typed JSON/Admin API.
- PostgreSQL 18: the primary database.
- Redis: ephemeral storage for authentication rate limiting.

```text
RentnerProxy/
├── web/
│   ├── public/
│   ├── src/
│   ├── tsconfig.json
│   └── vite.config.ts
├── controller/
│   ├── src/
│   ├── Cargo.lock
│   └── Cargo.toml
├── .env.example
├── docker-compose.yml
├── bun.lock
└── package.json
```

## Architecture boundary

```text
Browser -> TanStack Start -> Drizzle ORM -> PostgreSQL
                         \-> Bun Redis client -> Redis
                         \-> Rust controller
```

The browser only calls TanStack Start. Controller, database, and Redis health checks run behind
a server function, so connection URLs, credentials, and internal network details are never
returned to the client. Dependency outages do not crash the web process; authentication fails
closed while Redis abuse protection is unavailable.

In the appliance, the web service runs as UID 10002 and the controller plus Caddy run as UID 10001.
Proxy state directories use mode 0700 and controller/Caddy control sockets use mode 0600. Windows
development uses loopback TCP fallbacks; Unix socket isolation is a deployment boundary for the
Linux appliance.

Layout composition lives in `web/src/layout`, with application, authentication, and error-page
shells plus the theme control under `layout/Components`. `web/src/features/UserSettings/index.tsx`
composes account identity, profile image, language, password, and security sections from
`UserSettings/Components`. Their hooks, types, validation, and server functions live in the same
feature. Language/theme persistence remains in `web/src/server/UserSettings`, and account/security
services remain in `web/src/server/Auth`. Reusable controls remain in `web/src/shared`.

Action feedback uses the local toast components in `web/src/shared/Toast`, adapted from
RentnerToasts and styled with the project's theme tokens. No private toast package is installed.
Each public or authenticated layout owns its notification stack; changing users clears it.
Toasts follow the current language, keep at most three messages, pause while hovered or focused,
and support dismissal, swipe, and copying error messages. Field validation, permission notices,
and persistent page/loading errors remain next to the affected content.

## Docker start

Production installation uses one `docker-compose.yml`, one final image, and one data volume.
Only the email settings live outside the application:

```bash
cp .env.production.example .env
docker compose up -d
```

The image contains the web application, controller, Caddy, PostgreSQL, and Redis. On first
start it runs migrations and generates the database password, database URL, application
encryption key, and controller token automatically. They remain in the `rentnerproxy` volume and
are reused after updates or container recreation. The proxy listens on ports `80` and `443`; the
management UI is available only on the Docker host at `http://localhost:81` by default. During first-owner setup, enter the public
management address that users will open in their browser. For remote setup, use an SSH tunnel
(`ssh -L 8181:127.0.0.1:81 user@server`, then open `http://localhost:8181`) or deliberately
configure an HTTPS-protected management entry point before exposing it.

## Development

Development requires Bun 1.4 or newer and Rust 1.88 or newer. The runtime
container uses Rust 1.98.0; CI uses Rust 1.97.1. PostgreSQL 18 or newer
is required for persistence because the schema uses native `uuidv7()`; the current target is
18.6. Redis is required for authentication abuse protection.

```bash
bun install --frozen-lockfile
bun run dev
```

The development command starts both processes:

- Web application: `http://localhost:5173`
- Controller health endpoint: `http://127.0.0.1:8081/health`

Controller loopback defaults work without a local environment file. Copy `.env.example` to
`.env`, configure PostgreSQL, Redis, and the server-only authentication keys, and apply migrations with `bun run db:migrate`. Fresh
installations redirect to `/setup`. SMTP must be configured to send user invitations and
password-reset links.

`APP_ENCRYPTION_KEY` must decode from base64 to exactly 32 bytes and must be kept outside source
control. It encrypts authentication secrets at rest. `WEBAUTHN_RP_ID` is the WebAuthn relying-party
ID and must match the hostname used by `APP_URL`; for local development the documented
`http://localhost:5173` origin uses `localhost` (without the port). WebAuthn requires a secure
context in deployed environments; browsers allow the `localhost` development exception. Use the
same host consistently when testing passkeys. IP addresses such as `127.0.0.1` cannot be used as
WebAuthn RP IDs, even when the browser considers the loopback origin secure. Use
`APP_URL=http://localhost:5173` and `WEBAUTHN_RP_ID=localhost` locally, then restart `bun run dev`
after changing the environment. Sessions are host-specific, so switching from the IP address
to `localhost` requires signing in again.

Common commands:

```bash
bun run build
bun run format
bun run lint
bun run typecheck
bun run test
bun run db:generate
bun run db:migrate
bun run db:check
bun run check
```

`bun run check` runs formatting, linting, TypeScript and Drizzle checks, tests, Clippy, Cargo
checks, and both production builds. `bun run db:migrate` also synchronizes the permission registry
and built-in role defaults for existing installations. Custom roles keep their supported permissions;
the obsolete advanced configuration permission is removed during the Caddy upgrade.

## Feedback and contributions

- [Report a bug or request an enhancement](https://github.com/RentnerKev/RentnerProxy/issues) using the available issue template.
- [Contribute code or documentation](CONTRIBUTING.md) through a focused pull request.
- [Report a security vulnerability privately](SECURITY.md) through GitHub's private vulnerability reporting flow.

## Languages

Authenticated pages support English, German, Spanish, and French. Users select their language
in **Account → Language** and click **Save changes**. Selection alone does not save or switch the
interface language. After a successful save, the preference is stored in `user_settings.language`
and survives sign-out, reloads, and device changes. Existing users default to English. Apply the included database
migration with `bun run db:migrate` before starting the updated application.

The language directory follows TanstackDummy: one `useTranslationStore.ts` and `Locales/`.
Loaders, supported languages, and flags are configured in `web/src/config/language.config.ts`.
All authenticated interface copy lives in `web/src/language/Locales/{en,de,es,fr}.json`,
including validation, status messages, dialogs, tables, and accessibility labels. Keys and
interpolation variables must match across catalogs. Custom user data is not translated.

Public routes always remain English and do not load these catalogs. After authentication,
the server loads the user's selected catalog plus the English fallback. Each request and
authenticated user has an independent i18next instance; there is no global language or
local-storage preference shared between users. Regression tests cover these boundaries,
catalog completeness, language switching, and persisted settings.

To add a language, extend the supported languages and explicit loaders in
`web/src/config/language.config.ts`, all catalogs, and the local flag assets. Also extend the
`user_settings.language` database constraint through a migration.

## Runtime and upgrades

PostgreSQL is authoritative for desired proxy configuration. The controller keeps a bounded,
non-authoritative recovery snapshot. The web reconciliation worker reads PostgreSQL at startup,
retries pending changes with bounded backoff, and checks for drift without reloading healthy state. Every
snapshot uses protocol version 7 and the canonical keys `version`, `proxyHosts`, `redirectHosts`,
`httpSettings`, and `trustedCas`; versions 1 through 6 are rejected.

Caddy receives native JSON through its Admin API. Configuration loads are transactional and the
controller confirms the expected revision through its dedicated runtime probe before publishing
state. There is one Caddy engine: no Caddyfile input, compatibility layer, or dual-engine mode.
Public listeners support HTTP/1.1 and HTTP/2 with WebSocket forwarding; HTTP/3
and UDP are disabled. Caddy automatic HTTPS and certificate acquisition are disabled. RentnerProxy
continues to own certificate storage, import, ACME/Pebble issuance, renewal, trusted CAs, and
certificate assignment.

Restart recovery retains previously verified routes when a stored certificate has since expired;
new configuration activations still require unexpired certificates with matching domains.

Before upgrading, create and verify a backup with the currently installed version. Test the
new immutable image against a restored copy, then update deliberately. Upgrades migrate desired
state and certificate material; old runtime configuration is not executed. Advanced host
configuration and unsupported per-host send/keepalive overrides are archived by migration `0012`
in `proxy_host_legacy_settings` and are not emitted into Caddy. Downgrades are not automatic.
New backups use format 3. Restore also accepts formats 1 and 2; format 1 requires the original
application encryption key. Restore ignores old runtime files and rebuilds Caddy from desired state.

Structured host settings cover request-body size and upstream connect/read/write timeouts. Global
settings additionally control response and idle deadlines. The global response timeout is a total
response deadline under Caddy, including long streams; leave it unset when that deadline is unwanted.

## License

RentnerProxy is licensed under the [MIT License](./LICENSE).

Copyright (c) 2026 Kevin Sträßler.

The bundled Caddy binary is an Apache-2.0-licensed dependency. Its license is included at
[`docker/licenses/Caddy-LICENSE`](docker/licenses/Caddy-LICENSE).

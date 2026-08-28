<p align="center">
  <img src="./rentnerproxy-logo.png" alt="RentnerProxy project logo" width="300">
</p>

<h1 align="center">RentnerProxy</h1>

<p align="center">
  <strong>Modern Reverse Proxy Manager</strong>
</p>

<p align="center">
  A modern, self-hosted reverse proxy manager in the earliest stage of development,<br>
  with planned compatibility for NGINX® Open Source and released under the MIT License.
</p>

<p align="center">
  <a href="https://github.com/RentnerKev/RentnerProxy/actions/workflows/ci.yml"><img src="https://github.com/RentnerKev/RentnerProxy/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="https://github.com/RentnerKev/RentnerProxy/actions/workflows/codeql.yml"><img src="https://github.com/RentnerKev/RentnerProxy/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL status"></a>
</p>

> [!IMPORTANT]
> RentnerProxy is an early development foundation. It is not installable yet, does not
> manage reverse proxies, and is not ready for production use.

## Current foundation

The repository currently contains two runtime components, one persistence service, and one
ephemeral service:

- `web/`: a TanStack Start application with opaque sessions, RBAC, and server-only Drizzle ORM
  access to PostgreSQL.
- `controller/`: a minimal Rust service exposing a loopback-only `GET /health` endpoint.
- PostgreSQL 18: the external primary database; it is not started by this repository.
- Redis: external ephemeral storage for authentication rate limiting.

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

## Development

Development requires Bun 1.4 or newer and Rust 1.85 or newer. PostgreSQL 18 or newer
is required for persistence because the schema uses native `uuidv7()`; the current target is
18.6. Redis is required for authentication abuse protection.

```bash
bun install --frozen-lockfile
bun run dev
```

The development command starts both processes:

- Web application: `http://127.0.0.1:3000`
- Controller health endpoint: `http://127.0.0.1:8081/health`

Controller loopback defaults work without a local environment file. Copy `.env.example` to
`.env`, configure PostgreSQL and Redis, and apply migrations with `bun run db:migrate`. Fresh
installations redirect to `/setup`. SMTP must be configured to send user invitations and
password-reset links.

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
checks, and both production builds.

## Scope

Proxy management, NGINX/OpenResty integration, certificates, background jobs, audit logging, and
Docker deployment remain separate development steps.

## License

RentnerProxy is licensed under the [MIT License](./LICENSE).

Copyright (c) 2026 Kevin Sträßler.

NGINX® and the NGINX logo are trademarks of F5, Inc. RentnerProxy is independent and is not
affiliated with, sponsored by, or endorsed by F5, Inc.

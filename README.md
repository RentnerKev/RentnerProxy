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

> [!IMPORTANT]
> RentnerProxy is an early development foundation. It is not installable yet, does not
> manage reverse proxies, and is not ready for production use.

## Current foundation

The repository currently contains two runtime components:

- `web/`: a TanStack Start application with the development status screen.
- `controller/`: a minimal Rust service exposing a loopback-only `GET /health` endpoint.

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
Browser → TanStack Start → Rust controller
```

The browser only calls TanStack Start. The controller health request is made by a server
function, so controller URLs, internal environment variables, and network details are not
sent to the client. If the controller cannot be reached or returns an invalid response, the
web application reports it as unavailable.

## Development

Development requires Bun 1.4 or newer and Rust 1.85 or newer.

```bash
bun install --frozen-lockfile
bun run dev
```

The development command starts both processes:

- Web application: `http://127.0.0.1:3000`
- Controller health endpoint: `http://127.0.0.1:8081/health`

The loopback defaults work without a local environment file. To customize them, copy
`.env.example` to `.env` before starting the processes.

Common commands:

```bash
bun run build
bun run format
bun run lint
bun run typecheck
bun run test
bun run check
```

`bun run check` runs formatting, linting, TypeScript checks, tests, Clippy, Cargo checks, and
both production builds.

## Scope

Proxy management, authentication, persistence, NGINX/OpenResty integration, certificates,
background jobs, Docker deployment, and CI are intentionally not part of this foundation.
They will be evaluated in separate development steps.

## License

RentnerProxy is licensed under the [MIT License](./LICENSE).

Copyright (c) 2026 Kevin Sträßler.

NGINX® and the NGINX logo are trademarks of F5, Inc. RentnerProxy is independent and is not
affiliated with, sponsored by, or endorsed by F5, Inc.

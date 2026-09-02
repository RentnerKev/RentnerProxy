# Getting started

RentnerProxy is an early-development, self-hosted reverse proxy manager. It is not yet a stable
production release. Test upgrades, backups, and the proxy behavior before using it for critical
traffic.

## Prerequisites

For the container installation, install Docker Engine with the Docker Compose plugin. The bundled
appliance publishes:

- port 80 for proxied HTTP traffic;
- port 443 for proxied HTTPS traffic; and
- port 81 for the management UI.

For local development, use Bun 1.4 or newer, Rust 1.97.1, PostgreSQL 18 or newer, and Redis.

## Container installation

1. Clone the repository or download a source snapshot over HTTPS.
2. Copy the SMTP configuration template:

~~~bash
cp .env.production.example .env
~~~

3. Replace every example SMTP value in .env with the credentials for the mail service that should
   send invitations and password-reset messages. Never commit this file.
4. Start the appliance:

~~~bash
docker compose up -d
~~~

5. Open the management UI at http://localhost:81 for the initial owner setup. When prompted, enter
   the public management address that users will open in their browsers.
6. After setup, sign in, create only the required administrator accounts, and enable two-factor
   authentication or a passkey for administrator accounts.

The Compose file currently uses the latest image tag for convenience. For a controlled production
rollout, replace it with an immutable sha-<commit> image tag published by the container workflow,
test that image, and update deliberately.

## Local development

Install the locked dependencies and start the web application plus controller:

~~~bash
bun install --frozen-lockfile
bun run dev
~~~

The web application is available at http://localhost:5173 and the controller health endpoint at
http://127.0.0.1:8081/health. For database-backed development, copy .env.example to .env, configure
PostgreSQL and Redis, then apply the migrations:

~~~bash
bun run db:migrate
~~~

Useful commands:

~~~bash
bun run format
bun run lint
bun run typecheck
bun run test
bun run test:fuzz
bun run build
bun run check
~~~

## Secure operation

- Keep .env, database credentials, Redis credentials, application encryption keys, controller
  tokens, and ACME account material outside source control.
- Keep the management port on a trusted network. If it must be reachable outside the local
  network, put it behind an HTTPS reverse proxy and apply network access controls.
- Use HTTPS for public proxy traffic and use one consistent hostname for APP_URL and WebAuthn.
- Keep PostgreSQL and Redis private; the bundled appliance binds its internal services to loopback.
- Use the immutable image tag for production rollouts, review the changelog, and keep dependencies
  current.
- Back up the named RentnerProxy volume before upgrades and test restoring it.
- Do not paste passwords, tokens, private keys, or unredacted logs into issues or pull requests.

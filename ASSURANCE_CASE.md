# RentnerProxy assurance case

This is a lightweight, repository-backed assurance argument for the current
public-alpha implementation. It records intended security and reliability goals,
the threats that shape them, and evidence a reviewer can inspect. It is not a
certification, independent audit, coverage report, signed-build statement, or
reproducible-build claim. The system and reporting process remain subject to
[`README.md`](./README.md), [`SECURITY.md`](./SECURITY.md), and
[`CONTRIBUTING.md`](./CONTRIBUTING.md). The component boundaries are described in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

The bounded claim is: under the assumptions below, the linked implementation is
designed to enforce authentication and authorization at management/control entry
points, validate and constrain untrusted data before it reaches PostgreSQL or
Caddy, fail closed when trust or durable state is unavailable except for explicitly
documented availability-first controls, and preserve the durable state needed for
documented recovery. This claim is limited to the linked code paths and tested
configurations. It makes no claim of absolute security or availability.

## Scope and assumptions

The case covers the production appliance path: the Bun/TanStack web service,
PostgreSQL, Redis, the Rust controller, Caddy, the optional managed CrowdSec engine,
the persistent appliance volume, and the repository's backup/restore scripts. It assumes the operator protects the
host, Docker socket, volume, application encryption key, controller token, SMTP
credentials, deployment environment, and backup directory. ACME/DNS providers,
upstreams, SMTP, the host kernel, Docker, and base images are external dependencies
and are not proved correct here.

## Trust boundaries

1. **Internet or host clients to the data plane.** Public HTTP, HTTPS, and HTTP/3
   traffic enters Caddy. Managed upstreams are separate networks and are treated as
   untrusted; HTTPS upstreams use the system CA bundle or a controller-materialized
   configured CA, unless an administrator explicitly disables verification.
2. **Management browser to Bun.** The browser is untrusted. Session cookies are
   `HttpOnly`, `SameSite=Lax`, and secure in production; server functions apply CSRF
   middleware, session checks, permission checks, and recent-authentication checks.
   Live WebSocket upgrades are origin checked and replay the session cookie only to
   the server-side snapshot request.
3. **Bun to PostgreSQL and Redis.** These are local appliance services. PostgreSQL
   uses a restricted `rentnerproxy` role for the application; Redis is an ephemeral
   local broker/cache and is not a durable authority. Database queries are built
   through Drizzle/Bun SQL APIs and mutations use transactions and advisory locks.
4. **Bun to the Rust controller.** This is a local control boundary protected by a
   bearer token. The controller applies authorization and request validation to its control routes and owns Caddy
   configuration and certificate material; a non-loopback controller requires a
   token at startup.
5. **Controller to Caddy and providers.** The controller launches Caddy, talks to
   its private Unix admin/probe sockets, and verifies the active revision. The
   managed CrowdSec Local API is loopback-only; configured external CrowdSec APIs,
   ACME, DNS, SMTP, and upstream services remain external dependencies and can fail
   or return hostile data.

## Authentication, validation, and transport protections

[Password handling](web/src/server/Auth/Core/password.server.ts) uses Bun's Argon2id hashing.
[Session and permission checks](web/src/server/Auth/Access/authorization.service.ts) reject
missing sessions and permissions on protected operations. Recent authentication is checked where
required for sensitive actions; it is not a blanket requirement for every read.
[Login](web/src/server/Auth/Login/login.service.ts),
[two-factor authentication](web/src/server/Auth/TwoFactor/two-factor.service.ts), and
[passkeys](web/src/server/Auth/Passkey/passkey.service.ts) provide the authentication flows.
The password policy permits short nonempty passwords, so hashing alone cannot compensate for weak
user-selected credentials.

Server-side schemas constrain inputs, for example in
[certificate-job parsing](web/src/server/Admin/ProxyHostManagement/certificate-jobs.creation.ts).
[Proxy-host mutations](web/src/server/Admin/ProxyHostManagement/proxy-hosts.mutations.server.ts)
use Drizzle query construction and transactions rather than treating submitted text as SQL.
[CSRF middleware](web/src/start.ts) protects server functions, while
[security headers](web/src/server/security-headers.ts) provide CSP and browser hardening.
These controls reduce injection, cross-site request, and script-execution risks; they are not a
proof that every input or rendering path is free of weaknesses.

The controller configures HTTPS upstream certificate verification by default in
[the Caddy renderer](controller/src/runtime/renderer/proxy.rs). Administrators can disable it,
which forfeits upstream identity protection. Plain HTTP upstreams and the loopback management
listener do not themselves provide transport confidentiality. Use the deployment guidance in
[README.md](README.md) and protect remote management with an appropriate secure transport.

## Secure design principles and countermeasures

| Principle                             | Applied design                                                                                                                                                                                 | Common weakness countered                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Least privilege and separation        | Separate web/controller/PostgreSQL users and private state directories; restricted database role; controller-only certificate material; token-gated control API.                               | Unnecessary database superuser privileges or direct certificate-file access from the web Unix user.                  | [`docker/production/entrypoint.sh`](./docker/production/entrypoint.sh), [`docker/production/Dockerfile`](./docker/production/Dockerfile), [`controller/src/server/auth.rs`](./controller/src/server/auth.rs), [`controller/src/runtime/certificates/material_files.rs`](./controller/src/runtime/certificates/material_files.rs)                                                                                                               |
| Complete mediation                    | Server functions call session/permission services; controller routes use authorization middleware; jobs recheck permissions, ownership, and host revision before binding.                      | Authorization checked only in the UI, stale permissions, or an unguarded internal endpoint.                          | [`web/src/server/Auth/Access/authorization.service.ts`](./web/src/server/Auth/Access/authorization.service.ts), [`web/src/server/Auth/Access/rbac.service.ts`](./web/src/server/Auth/Access/rbac.service.ts), [`controller/src/server/mod.rs`](./controller/src/server/mod.rs), [`web/src/server/Admin/ProxyHostManagement/certificate-jobs.binding.server.ts`](./web/src/server/Admin/ProxyHostManagement/certificate-jobs.binding.server.ts) |
| Fail-safe defaults                    | Loopback controller, empty trusted-proxy list, strict forwarded-protocol matching, unavailable certificate store returns failure, and failed candidate activation keeps valid active material. | Forwarded-header spoofing, fail-open TLS/proxy behavior, or destructive partial replacement during an outage.        | [`controller/src/config.rs`](./controller/src/config.rs), [`controller/src/runtime/renderer/routes.rs`](./controller/src/runtime/renderer/routes.rs), [`controller/src/runtime/certificates/activation.rs`](./controller/src/runtime/certificates/activation.rs), [`web/src/server/env.server.ts`](./web/src/server/env.server.ts)                                                                                                             |
| Defense in depth and input validation | Browser/server validation, Drizzle parameter binding, Rust model/revision validation, Caddy config limits, secret-file checks, and security headers/CSP.                                       | SQL injection, configuration injection, malformed certificate/proxy data, XSS, and oversized resource consumption.   | [`controller/src/proxy/mod.rs`](./controller/src/proxy/mod.rs), [`controller/src/server/mod.rs`](./controller/src/server/mod.rs), [`docker/web/bootstrap-secrets.mjs`](./docker/web/bootstrap-secrets.mjs), [`web/src/server/security-headers.ts`](./web/src/server/security-headers.ts), [`web/src/server/Auth/Core/encryption.server.ts`](./web/src/server/Auth/Core/encryption.server.ts)                                                   |
| Atomicity, idempotence, and recovery  | PostgreSQL transactions/advisory locks, idempotent certificate jobs, leases, atomic private-file writes, durable cursor/receipt IDs, and revision probes.                                      | TOCTOU updates, duplicate work, torn state, replayed events, and “database says applied” drift.                      | [`web/src/db/migrate.ts`](./web/src/db/migrate.ts), [`web/src/server/ProxyRuntime/proxy-reconcile.ts`](./web/src/server/ProxyRuntime/proxy-reconcile.ts), [`controller/src/runtime/state.rs`](./controller/src/runtime/state.rs), [`web/src/server/Admin/CertificateManagement/certificate-events.worker.ts`](./web/src/server/Admin/CertificateManagement/certificate-events.worker.ts)                                                       |
| Minimize and protect secrets          | AES-GCM with context/AAD for selected web secrets and DNS credentials; private secret files.                                                                                                   | Plaintext exposure of the encrypted secret fields in a database or controller-state copy without its encryption key. | [`web/src/server/Auth/Core/encryption.server.ts`](./web/src/server/Auth/Core/encryption.server.ts), [`controller/src/runtime/dns/encryption.rs`](./controller/src/runtime/dns/encryption.rs), [`web/src/server/security-headers.ts`](./web/src/server/security-headers.ts), [`web/src/tests/auth-security-encryption.test.ts`](./web/src/tests/auth-security-encryption.test.ts)                                                               |

## Goals and claims

| ID  | Claim                                                                                                                                                                                                 | Main evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | A desired proxy revision is applied only after controller validation, Caddy acceptance, and a matching runtime probe.                                                                                 | [`controller/src/runtime/apply.rs`](./controller/src/runtime/apply.rs), [`controller/src/runtime/engine.rs`](./controller/src/runtime/engine.rs), [`controller/src/runtime/configuration.rs`](./controller/src/runtime/configuration.rs), [`web/src/server/ProxyRuntime/proxy-reconcile.ts`](./web/src/server/ProxyRuntime/proxy-reconcile.ts), [`controller/src/tests/runtime.rs`](./controller/src/tests/runtime.rs), [`web/src/tests/proxy-runtime.test.ts`](./web/src/tests/proxy-runtime.test.ts)                                                                                                                                                                                                                                                                                                                                                                     |
| G2  | Management and controller operations have explicit authentication, authorization, origin, input, and forwarding-trust checks.                                                                         | [`controller/src/server/auth.rs`](./controller/src/server/auth.rs), [`controller/src/config.rs`](./controller/src/config.rs), [`web/src/server/Auth/Access/authorization.service.ts`](./web/src/server/Auth/Access/authorization.service.ts), [`web/src/server/env.server.ts`](./web/src/server/env.server.ts), [`web/src/websockets/Server/realtimeWebSocket.ts`](./web/src/websockets/Server/realtimeWebSocket.ts), [`controller/src/tests/config.rs`](./controller/src/tests/config.rs), [`controller/src/tests/proxy_validation.rs`](./controller/src/tests/proxy_validation.rs), [`web/src/tests/env.server.test.ts`](./web/src/tests/env.server.test.ts), [`web/src/tests/runtime-peer-ip.test.ts`](./web/src/tests/runtime-peer-ip.test.ts)                                                                                                                         |
| G3  | Certificate private material and activation are controller-owned, validated, staged, and recoverable without silently replacing a valid active certificate.                                           | [`controller/src/runtime/certificates/material_files.rs`](./controller/src/runtime/certificates/material_files.rs), [`controller/src/runtime/certificates/staging.rs`](./controller/src/runtime/certificates/staging.rs), [`controller/src/runtime/certificates/activation.rs`](./controller/src/runtime/certificates/activation.rs), [`controller/src/runtime/certificates/recovery.rs`](./controller/src/runtime/certificates/recovery.rs), [`controller/src/tests/certificates.rs`](./controller/src/tests/certificates.rs), [`controller/src/tests/certificate_operations.rs`](./controller/src/tests/certificate_operations.rs), [`scripts/certificate-state-restore-smoke.ts`](./scripts/certificate-state-restore-smoke.ts)                                                                                                                                         |
| G4  | Web certificate jobs bind only current, authorized host state and retain idempotent, encrypted work data across worker restarts.                                                                      | [`web/src/db/Schema/certificateJobs.ts`](./web/src/db/Schema/certificateJobs.ts), [`web/src/server/Admin/ProxyHostManagement/certificate-jobs.creation.ts`](./web/src/server/Admin/ProxyHostManagement/certificate-jobs.creation.ts), [`web/src/server/Admin/ProxyHostManagement/certificate-jobs.worker.server.ts`](./web/src/server/Admin/ProxyHostManagement/certificate-jobs.worker.server.ts), [`web/src/server/Admin/ProxyHostManagement/certificate-jobs.binding.server.ts`](./web/src/server/Admin/ProxyHostManagement/certificate-jobs.binding.server.ts), [`web/src/tests/certificate-jobs-worker-postgresql.integration.test.ts`](./web/src/tests/certificate-jobs-worker-postgresql.integration.test.ts), [`web/src/tests/certificate-jobs-creation-postgresql.integration.test.ts`](./web/src/tests/certificate-jobs-creation-postgresql.integration.test.ts) |
| G5  | Certificate operation events are cursorable and deduplicated into PostgreSQL receipts and audit rows; ephemeral live notifications do not serve as durable state.                                     | [`controller/src/runtime/certificates/operations.rs`](./controller/src/runtime/certificates/operations.rs), [`web/src/server/Admin/CertificateManagement/certificate-events.worker.ts`](./web/src/server/Admin/CertificateManagement/certificate-events.worker.ts), [`web/src/db/Schema/certificates.ts`](./web/src/db/Schema/certificates.ts), [`web/src/server/Audit/audit.service.ts`](./web/src/server/Audit/audit.service.ts), [`web/src/tests/certificate-events.test.ts`](./web/src/tests/certificate-events.test.ts), [`web/src/tests/certificate-events-postgresql.integration.test.ts`](./web/src/tests/certificate-events-postgresql.integration.test.ts), [`web/src/tests/audit-events-postgresql.integration.test.ts`](./web/src/tests/audit-events-postgresql.integration.test.ts)                                                                           |
| G6  | The appliance's documented backup contains the durable database, controller state, and application key, while transient Redis/cache/log state is identified as excluded.                              | [`scripts/production-backup.ts`](./scripts/production-backup.ts), [`scripts/controller-state-archive.ts`](./scripts/controller-state-archive.ts), [`scripts/production-restore.ts`](./scripts/production-restore.ts), [`scripts/restore-rollback-smoke.ts`](./scripts/restore-rollback-smoke.ts), [`tests/production/appliance-compose-smoke.ts`](./tests/production/appliance-compose-smoke.ts), [`README.md`](./README.md)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G7  | State and external input have bounded formats and failure handling, including database migration locking, secret validation, proxy model validation, and controller request limits.                   | [`web/src/db/migrate.ts`](./web/src/db/migrate.ts), [`docker/web/bootstrap-secrets.mjs`](./docker/web/bootstrap-secrets.mjs), [`controller/src/server/mod.rs`](./controller/src/server/mod.rs), [`controller/src/models.rs`](./controller/src/models.rs), [`controller/src/proxy/mod.rs`](./controller/src/proxy/mod.rs), [`controller/src/tests/config.rs`](./controller/src/tests/config.rs), [`controller/src/tests/proxy_validation.rs`](./controller/src/tests/proxy_validation.rs), [`web/src/tests/env.server.test.ts`](./web/src/tests/env.server.test.ts)                                                                                                                                                                                                                                                                                                         |
| G8  | Web security controls protect sessions, secret values, rendered HTML, and HTTPS upstream identity when verification is enabled.                                                                       | [`web/src/server/Auth/Access/cookies.server.ts`](./web/src/server/Auth/Access/cookies.server.ts), [`web/src/server/Auth/Core/encryption.server.ts`](./web/src/server/Auth/Core/encryption.server.ts), [`web/src/server/security-headers.ts`](./web/src/server/security-headers.ts), [`controller/src/runtime/renderer/proxy.rs`](./controller/src/runtime/renderer/proxy.rs), [`web/src/tests/auth-security-encryption.test.ts`](./web/src/tests/auth-security-encryption.test.ts), [`web/src/tests/security-headers.test.ts`](./web/src/tests/security-headers.test.ts), [`web/src/tests/mail-templates.test.ts`](./web/src/tests/mail-templates.test.ts), [`scripts/upstream-tls-smoke.ts`](./scripts/upstream-tls-smoke.ts)                                                                                                                                             |
| G9  | Repository automation runs formatting, lint, type, migration, web, fuzz, Rust, CodeQL, secret-scanning, and dependency-review jobs.                                                                   | [`.github/workflows/ci.yml`](./.github/workflows/ci.yml), [`.github/workflows/codeql.yml`](./.github/workflows/codeql.yml), [`.github/workflows/gitleaks.yml`](./.github/workflows/gitleaks.yml), [`.github/workflows/dependency-review.yml`](./.github/workflows/dependency-review.yml)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| G10 | CrowdSec is disabled by default; enabled modes share Caddy client-IP semantics, validate a replacement before switching, keep credentials server-side, and fail open during temporary Local API loss. | [`controller/src/runtime/crowdsec.rs`](./controller/src/runtime/crowdsec.rs), [`controller/src/runtime/renderer/config.rs`](./controller/src/runtime/renderer/config.rs), [`web/src/server/Admin/CrowdSec/crowdsec.service.ts`](./web/src/server/Admin/CrowdSec/crowdsec.service.ts), [`web/src/server/Admin/CrowdSec/crowdsec-settings.ts`](./web/src/server/Admin/CrowdSec/crowdsec-settings.ts), [`controller/src/tests/runtime.rs`](./controller/src/tests/runtime.rs), [`controller/src/tests/renderer.rs`](./controller/src/tests/renderer.rs), [`web/src/tests/crowdsec-settings.test.ts`](./web/src/tests/crowdsec-settings.test.ts), [`tests/production/proxy-smoke.ts`](./tests/production/proxy-smoke.ts), [`tests/production/appliance-compose-smoke.ts`](./tests/production/appliance-compose-smoke.ts)                                                       |

The [Bun audit workflow](.github/workflows/bun-audit.yml) checks JavaScript dependencies, and
[Production Smokes](.github/workflows/production-smokes.yml) exercises selected appliance and
proxy paths. Workflow definitions establish what is configured to run; check the actual run
results for the commit under review before treating the gates as passed.

## Threats and argument

### T1: Network clients forge forwarding headers or reach internal control paths

The controller defaults to loopback and requires a bearer token for non-loopback
listeners. Caddy only honors forwarded protocol data for configured direct peers;
the web service has a separate, explicit proxy-header setting. The WebSocket
handshake checks the configured origin and connection limits. These controls support
G2, but they rely on the operator selecting narrow trusted CIDRs and protecting the
host network. See the implementation and tests linked under G2 and the deployment
guidance in [`README.md`](./README.md).

### T2: A stale or replayed asynchronous request changes a host

Certificate jobs carry an idempotency key, request digest, required permissions,
host revision, lease, and desired state. The worker rechecks those values before
assignment, while the controller checks certificate/domain coverage and the final
proxy revision. This supports G1 and G4. PostgreSQL availability and a correct
operator-managed encryption key remain prerequisites.

### T3: Caddy rejects a configuration or applies a different revision

The controller serializes apply operations, bounds request/configuration sizes,
loads through its local admin socket, and probes the revision served by Caddy before
success. Web reconciliation compares the acknowledged revision with the latest
database snapshot and retries or reports pending on failure. This supports G1;
it does not prove that an upstream is healthy or that every possible Caddy failure
mode is covered.

### T4: Invalid, mismatched, or partially activated certificate material is used

The controller parses certificates and private keys, checks their pairing and
validity, writes complete material versions, and records candidates before
activation. Candidate activation verifies the staged material and retains the active
material when activation fails. Recovery reconciles the index and sidecar manifests.
This supports G3. Private-key confidentiality still depends on filesystem and host
protection, and an operator can lose recovery capability by omitting the state
archive or application key.

### T5: Events are duplicated, skipped, or confused with live notifications

The controller event journal uses stable IDs, a store ID, bounded retention, and
cursor validation. The web synchronizer advances a PostgreSQL cursor while inserting
event receipts with a unique event ID and writing system audit records in one
transaction. Redis/WebSocket application-change signals are only cache invalidation
and live refresh hints. This supports G5; events older than the journal or receipt
retention window are not reconstructed by this design.

### T6: Restart, upgrade, or restore loses the state needed to serve traffic

The appliance volume retains PostgreSQL and controller/Caddy state. The production
backup explicitly captures the PostgreSQL dump, controller archive, and application
key and deliberately excludes sockets, caches, Redis, and logs. Restore scripts
replace a target project and include rollback checks. This supports G6, subject to
quiescing, preserving the deployment environment, and testing the restored instance.
Backups are not automatically encrypted or transported by these scripts; the
operator must protect them.

### T7: Resource exhaustion, dependency failure, or malformed input degrades service

Request bodies, query sizes, rendered configuration, WebSocket messages,
subscriptions, controller event pages, access-log snapshots, retries, and database
metadata fields have explicit bounds in code. Health/readiness endpoints and
supervision expose failed local dependencies. The limits reduce accidental or
hostile load but do not provide availability against a hostile host, exhausted
disk, PostgreSQL failure, Redis failure, DDoS, ACME/DNS outage, SMTP outage, or
upstream failure.

### T8: CrowdSec is bypassed, leaks a credential, or causes a proxy outage

Disabled mode omits the Caddy handler. Enabled modes use Caddy's effective client address after
strict trusted-proxy processing, so untrusted forwarding headers do not select the evaluated
identity. External credentials are context-encrypted in PostgreSQL and never returned to the
browser; the managed bouncer key is a narrowly permissioned file. Provider transitions validate
the target before Caddy replacement, while streamed enforcement deliberately uses hard-fail-off
semantics so a temporary Local API outage does not halt public traffic. This supports G10. It
also means an outage can create a temporary detection/enforcement gap, and cached decisions are
only as current as the last successful stream.

## Residual risks and limits

- Redis is intentionally ephemeral and is not part of the backup contract. A restart
  can remove live invalidation signals, rate-limit state, and pending authentication
  challenge state; durable reads and login flows must recover through their normal
  stores.
- Proxy request logs and in-memory access-log pagination snapshots are bounded and
  excluded from production backups. They are operational telemetry, not an audit
  archive.
- Managed CrowdSec state is stored in the appliance volume but is not included in the current
  v3 repository backup archive. Volume-level preservation is required until issue #71 extends
  backup/restore coverage.
- CrowdSec's fail-open behavior favors proxy availability during Local API failures. New or
  refreshed decisions cannot be guaranteed while the selected API is unavailable.
- The Caddy CrowdSec bouncer is a pinned community module rather than an official Caddy or
  CrowdSec component. The build strips AppSec and Layer 4 packages and verifies source and Hub
  digests, but future Caddy upgrades still require compatibility and advisory review.
- The application encryption key, controller token, public origin, trusted proxy
  CIDRs, SMTP configuration, port mappings, image reference, and Compose project are
  deployment inputs. A database dump alone cannot recreate a working appliance.
- Credential agility is only partially evidenced. [Web secret loading](web/src/server/env.server.ts)
  supports separate files for the application key, database URL, and controller token; certificate
  material is also stored separately. SMTP credentials remain direct environment inputs, and some
  authentication/secret records live in PostgreSQL or controller metadata. This review has not
  demonstrated separate-file storage and replacement for every relevant credential/key. Do not
  replace the application encryption key independently of the matching encrypted data: a restore
  preserves that pairing and is not a general key-rotation procedure.
- Caddy inherits the controller's Unix identity and can access its serving certificate files.
  Compromise of that identity crosses both components. The web process also holds the controller
  token and can exercise its privileged API; file ownership reduces direct access but does not
  isolate the control API from a compromised web process. Host/root compromise defeats these
  local boundaries.
- The design is a single-appliance process topology. Host, volume, Docker, kernel,
  base-image, PostgreSQL, Redis, Caddy, ACME/DNS, SMTP, and upstream failures remain
  operational risks.
- The repository's tests and smoke scripts provide focused evidence for listed paths;
  they do not establish exhaustive behavior, formal verification, penetration-test
  coverage, independent review, signed artifacts, or reproducible builds.
- This document describes the current source tree. Release-specific behavior,
  upgrade requirements, and vulnerability reporting remain governed by
  [`README.md`](./README.md), [`SECURITY.md`](./SECURITY.md), and
  [`CONTRIBUTING.md`](./CONTRIBUTING.md).

[RELEASING.md](RELEASING.md) records the release-signing and reproducibility gaps. Planned review
work in [ROADMAP.md](ROADMAP.md) must not be treated as completed security validation.

## Review procedure

Reviewers should start with [`ARCHITECTURE.md`](./ARCHITECTURE.md), inspect the
implementation links in the claims table, and run the checks required by
[`CONTRIBUTING.md`](./CONTRIBUTING.md) in an environment with their needed
dependencies. The repository does not treat a passing local check as evidence that
the external provider, host, deployment configuration, or recovery procedure is
safe for a particular installation.

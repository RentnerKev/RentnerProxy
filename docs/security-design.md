# Security design

This document records the security principles and threat boundaries used by RentnerProxy. It is
part of the design record for the primary developer and contributors, not a guarantee that the
software is defect-free.

## Security boundaries and assumptions

RentnerProxy separates the browser, TanStack Start, PostgreSQL, Redis, the Rust controller, and
the OpenResty proxy runtime. Browser requests do not receive database URLs, Redis URLs, controller
tokens, application encryption keys, password hashes, or private certificate material.

The controller and the database are internal services. The public trust boundary is the browser
to web application path and the configured proxy listener. A deployment must protect the
management UI and must not expose the controller's internal API directly.

## Secure design principles

- Economy of mechanism: authentication, authorization, input validation, and runtime application
  are kept in separate services and small focused modules.
- Fail-safe defaults: access checks deny by default, disabled users cannot authenticate, and
  missing security configuration fails closed for protected operations.
- Complete mediation: session freshness, permissions, controller bearer authentication, canonical
  domains, UUIDs, and filesystem boundaries are checked at the operation entry point and again
  inside critical database transactions where required.
- Open design: security does not depend on hidden source code. Secrets and keys are supplied through
  protected runtime files or environment configuration and are never hard-coded.
- Separation of privilege: account changes require recent authentication and permissions; passkey
  registration requires user verification; controller and certificate operations use a separate
  bearer token.
- Least privilege: the application and proxy runtime use non-root user 10001 where possible;
  containers drop capabilities and enable no-new-privileges. The appliance supervisor retains only
  CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID, and KILL for bootstrap and shutdown; individual
  services run under their service UIDs. The management port binds to host loopback by default.
- Least common mechanism and limited attack surface: PostgreSQL, Redis, and controller listeners
  bind to loopback inside the appliance, the browser receives only intended DTOs, and internal
  endpoints are not public application routes.
- Psychological acceptability: validation, permission, and failure feedback is returned in safe
  categories without disclosing secrets or internal filesystem paths.
- Allowlists: domains, UUIDs, tokens, file paths, locales, transports, and configuration values
  are validated against canonical allowlists before use.

## Common vulnerability classes and mitigations

- SQL injection: Drizzle query builders and parameterized queries are used; raw SQL is limited to
  controlled migrations and bootstrap checks.
- OS or command injection: external commands are called with fixed argument structure, validated
  paths, bounded values, and explicit runtime ownership.
- Path traversal: filesystem paths are resolved within validated state directories and checked at
  every sink.
- Cross-site scripting: React renders user-controlled values through normal escaped output and
  server/client boundaries prevent server-only data from reaching browser bundles.
- Missing authentication or authorization: route guards, session checks, permission checks, and
  controller bearer authentication protect operations.
- Credential theft: passwords use Argon2id; opaque tokens are generated with a CSPRNG and stored
  as SHA-256 digests; TOTP, recovery codes, and application secrets are protected separately.
- Replay and CSRF: session cookies are HttpOnly, state-changing requests use CSRF protection,
  one-time challenges are consumed, and sensitive operations use recent authentication.
- Supply-chain tampering: lockfiles are committed, GitHub Actions are pinned to commit SHAs,
  dependency changes receive review, and CI runs dependency review, Bun audit, Gitleaks, CodeQL,
  Scorecard, linting, and tests.

The application PostgreSQL role owns only its application database and has no superuser,
role-creation, database-creation, replication, or RLS-bypass privileges. Bootstrap administration
uses the separate postgres role with no TCP password through a postgres-owned 0700 Unix socket
directory. Offline backup and restore use that same private socket boundary. Older development
volumes created with the application as their only superuser must be migrated explicitly before
this bootstrap can start; initialization never discards their data.

## Proxy and runtime defaults

Generated Nginx configuration uses automatic worker selection and a shared 10 MiB TLS session
cache. TLS 1.2/1.3 and the cipher policy are defined once at HTTP scope so the default SNI listener
uses the same policy. Unknown TLS names are rejected. Version banners are hidden; idle request
headers expire after 15 seconds. HTTP and TLS hosts use the same header-rendering helper.

The proxy listener is a public trust boundary: X-Real-IP and X-Forwarded-For are rebuilt from the
connection address, X-Forwarded-Host and X-Forwarded-Proto from the accepted host and transport.
Client-supplied Forwarded, X-Forwarded-Port, X-Forwarded-Prefix, and Proxy headers are removed. Deployments behind another proxy require
an explicit, restricted trusted-proxy design before using that proxy's client-IP claims.
Every HTTPS upstream requires an explicit TLS policy; missing policy is rejected even for old
snapshot versions. Certificate verification is the default in the web application. Disabling it
remains an explicit administrator choice for test backends.

Advanced Nginx configuration is privileged native configuration, including OpenResty code and
filesystem access under the service UID. It is not a sandbox for untrusted tenants. Grant expert
configuration permissions only to administrators trusted with the appliance itself.

The Bun listener caps request bodies at 12 MiB, including JSON/base64 overhead for the existing
8 MiB avatar limit, and passes only its actual socket peer address into request-local IP metadata.
Login IP limits never trust client-provided forwarding headers. An extra proxy in front of the
management application currently shares its peer-IP quota across its clients.

Active Nginx state is read through bounded, regular-file-only state access. Certificate index
writes enforce the same 10,000-entry and 8 MiB limits as startup, with room reserved for ACME
failure recovery. Rejected updates retain the last usable state.

See the [Nginx SSL module documentation](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
for protocol selection and shared-session-cache behavior.

## Cryptography

RentnerProxy uses standard, FLOSS implementations rather than implementing cryptographic
primitives itself:

- AES-256-GCM with a fresh cryptographically random IV protects authentication secrets at rest.
- Argon2id is used for password hashing; the encoded hash contains the per-user salt and parameters.
- SHA-256 is used for opaque-token and recovery-code verification digests.
- TOTP follows RFC 6238 through OTPAuth with HMAC-SHA256, six-digit codes, and a 30-second period.
- WebAuthn verification uses the SimpleWebAuthn server library with required user verification.
- TLS is provided by OpenResty/rustls with TLS 1.2 and TLS 1.3 configuration and modern cipher
  suites.

AES encryption uses a fixed 256-bit key, opaque tokens use 256 bits, recovery codes use
128 bits of random material, and the application does not provide a downgrade option for its AES
encryption key. New TOTP factors use 256-bit secrets and a fixed HMAC-SHA256 configuration without
a runtime algorithm override. Nonces and token material come from Bun/Node cryptographically secure
random APIs or the Web Crypto API.

## Analysis and response

CodeQL runs for JavaScript/TypeScript, Rust, and GitHub Actions on pushes, pull requests, and a
weekly schedule. Fuzz and property-based tests run in CI. Confirmed medium-or-higher severity
findings are triaged, fixed, and verified with regression tests before a release where practical.

Report vulnerabilities through [SECURITY.md](../SECURITY.md). Do not use public issues for
sensitive security reports.

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
  containers drop capabilities and enable no-new-privileges.
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

## Cryptography

RentnerProxy uses standard, FLOSS implementations rather than implementing cryptographic
primitives itself:

- AES-256-GCM with a fresh cryptographically random IV protects authentication secrets at rest.
- Argon2id is used for password hashing; the encoded hash contains the per-user salt and parameters.
- SHA-256 is used for opaque-token and recovery-code verification digests.
- TOTP follows RFC 6238 through OTPAuth. HMAC-SHA1 is used only as the standards-compatible TOTP
  construction, not as a general-purpose password or data hash.
- WebAuthn verification uses the SimpleWebAuthn server library with required user verification.
- TLS is provided by OpenResty/rustls with TLS 1.2 and TLS 1.3 configuration and modern cipher
  suites.

AES encryption uses a fixed 256-bit key, opaque tokens use 256 bits, recovery codes use
128 bits of random material, and the application does not provide a downgrade option for its AES
encryption key. TOTP currently uses HMAC-SHA1 solely for RFC 6238 interoperability; this is the
documented compatibility exception and is tracked for a future SHA-256 migration before a stable
release. Nonces and token material come from Bun/Node cryptographically secure random APIs or the
Web Crypto API.

## Analysis and response

CodeQL runs for JavaScript/TypeScript, Rust, and GitHub Actions on pushes, pull requests, and a
weekly schedule. Fuzz and property-based tests run in CI. Confirmed medium-or-higher severity
findings are triaged, fixed, and verified with regression tests before a release where practical.

Report vulnerabilities through [SECURITY.md](../SECURITY.md). Do not use public issues for
sensitive security reports.

# Changelog

All notable changes to RentnerProxy are documented here. Public releases will also include a
human-readable GitHub Release with the same summary. This file is intentionally a summary of
user-visible changes, not a raw commit log.

## [v1.0.0-alpha.2]

### Added

- Cloudflare DNS-01 certificates, including wildcard and mixed wildcard/ordinary names.
- Reusable access policies with Basic Authentication and IPv4/IPv6 allow/deny rules.
- A filtered proxy request log viewer and a separate administrative audit log.

### Fixed

- Serialized database startup migrations and authorization synchronization, with retry coverage.
- Added actual Alpha 1 appliance upgrade, repeated startup and backup/restore verification.
- Restoring an older backup replaces newer application-schema objects in the same transaction;
  a failed SQL restore preserves the previous database.
- Bounded release-validation test subprocesses and aligned the CI Bun version with the appliance.
- Fixed administrative response headers and preserved client-cancellation handling across updated
  TanStack Start dependencies.

### Upgrade notes and limitations

- Back up before upgrading; follow the [upgrade and recovery guide](docs/upgrades.md).
  Rollback requires restoring the pre-upgrade backup into fresh volumes with the previous image.
- Existing hosts remain public until an access policy is assigned. A protected policy with no
  configured method denies access. Basic Auth and IP checks support All/Any combinations.
- DNS-01 currently supports Cloudflare and one zone per certificate request.
- IP rules use the directly connected client address; forwarded headers do not select that address.
- Proxy request logs are bounded local history, excluded from backups. Administrative audit events
  are retained for up to 90 days and 100,000 rows and are included in database backups.
- Alpha releases use the `alpha` image channel; `latest` remains reserved for stable releases.

### Alpha 1 feedback triage

As of 12 September 2026, [#35](https://github.com/RentnerKev/RentnerProxy/issues/35) contains no
tester comments or linked actionable reports. No tester-reported P0/P1 regression or deferred
feedback item was identified. The migration and reliability work is tracked separately in
[#34](https://github.com/RentnerKev/RentnerProxy/issues/34).

## Earlier development notes — 2026-09-02

### Added

- Added the first documented getting-started guide, HTTP/service interface reference, security
  design notes, testing guide, and release checklist.
- Added the OpenSSF Best Practices badge to the project README.
- Added a dedicated CI job for the repository's fuzz and property-based tests.

### Security

- Documented the current threat model, secure defaults, cryptographic boundaries, and
  vulnerability-reporting process.
- Continued hardening filesystem boundaries, runtime state handling, container privileges, and
  secret-like test fixtures.

## Release policy

Every user-facing release must:

1. use a unique SemVer-compatible version identifier;
2. be identified by an annotated Git tag;
3. include a GitHub Release with a concise summary of added, changed, fixed, and security-relevant
   behavior; and
4. identify every known project runtime vulnerability fixed in that release.

[v1.0.0-alpha.2]: https://github.com/RentnerKev/RentnerProxy/compare/v1.0.0-alpha.1...v1.0.0-alpha.2

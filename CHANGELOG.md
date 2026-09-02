# Changelog

All notable changes to RentnerProxy are documented here. Public releases will also include a
human-readable GitHub Release with the same summary. This file is intentionally a summary of
user-visible changes, not a raw commit log.

## [Unreleased] — 2026-09-02

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

[Unreleased]: https://github.com/RentnerKev/RentnerProxy/compare/HEAD...HEAD

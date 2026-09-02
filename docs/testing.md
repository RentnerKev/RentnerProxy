# Testing and verification

RentnerProxy uses public, FLOSS test tools and runs automated checks in GitHub Actions for pushes
to main and pull requests targeting main.

## Standard commands

```bash
bun run test
bun run test:ts
bun run test:fuzz
bun run rust:test
bun run check
```

The test suite is invocable using Bun's standard test runner and Cargo's standard Rust test
command. The complete check also runs formatting, Oxlint, TypeScript checks, Drizzle migration
checks, Cargo checks, Clippy with warnings denied, and production builds.

## Test coverage by area

- Unit and contract tests cover authentication, sessions, authorization, validation, tokens,
  encryption, mail templates, database health, tables, layouts, and proxy configuration.
- PostgreSQL and Redis integration suites run when the corresponding CI services are enabled.
- Rust tests cover controller configuration, proxy rendering, runtime state, certificates, ACME,
  server handlers, and authentication.
- Fuzz and property-based suites use fast-check to vary environment values, mail-template inputs,
  and opaque-token inputs.
- Browser and OpenResty smoke scripts exercise the real runtime boundary, TLS, SNI, ACME, and
  rollback paths when the integration environment is available.

## Test policy

New major functionality, security-sensitive behavior, and externally visible changes must add or
update automated tests. Tests should cover successful paths, invalid input, permission failures,
and dependency/runtime failures where relevant. The policy is enforced through the pull-request
template, CONTRIBUTING.md, and CI checks.

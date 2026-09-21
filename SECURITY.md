# Security Policy

## Supported versions

RentnerProxy is in public alpha and has no stable release. It is suitable for testing and
non-critical deployments, but it should not be treated as production-ready for critical traffic.
Security fixes currently target the latest commit on `main`; older commits and unreleased
snapshots are not supported.

| Version       | Supported |
| ------------- | --------- |
| `main`        | Yes       |
| Older commits | No        |

## Security expectations

The [security assurance case](ASSURANCE_CASE.md) describes intended protections, deployment
assumptions, supporting code and tests, and residual risks. The [architecture](ARCHITECTURE.md)
documents service and certificate ownership boundaries. These are evidence-based design
arguments, not an independent security certification. The [release process](RELEASING.md)
documents the current absence of release-signature verification and reproducibility guarantees.

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Use GitHub's [private vulnerability reporting form](https://github.com/RentnerKev/RentnerProxy/security/advisories/new) to report a vulnerability. It creates a private security advisory that only repository maintainers and invited collaborators can access.

If the form is temporarily unavailable, do not disclose the vulnerability in a public issue. The project does not currently publish an alternative private contact address.

Include a clear description, affected component, reproduction steps or proof of concept, impact, and any suggested mitigation. Remove live credentials and other unrelated sensitive data. If a real credential was exposed, revoke or rotate it immediately.

The maintainer will coordinate validation, remediation, and responsible disclosure through the private advisory. The initial acknowledgement target is within 14 calendar days. Confirmed medium-or-higher severity issues are prioritized for a timely fix and are identified in the release notes when a release is available.

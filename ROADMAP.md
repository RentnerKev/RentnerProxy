# Roadmap

This roadmap covers September 2026 through September 2027. It describes intended direction, not
promised delivery dates. Phases may overlap or take longer, depending on tester feedback, release
blockers, and the capacity of the single maintainer. The project remains in alpha; reaching beta
or 1.0 during this period is not guaranteed.

## Alpha hardening

Stabilize the existing Caddy appliance, host configuration, certificate lifecycle, live
administration, and upgrade/recovery paths described in [README.md](README.md). Address reported
UI inconsistencies, including the [per-host configuration editor review](https://github.com/RentnerKev/RentnerProxy/issues/108).
Continue focused regression coverage for failures and compatibility rather than redesigning the
application.

## Beta readiness

Use the [Beta 1 release gate](https://github.com/RentnerKev/RentnerProxy/issues/75) to decide what
must ship and what can be explicitly deferred. Evaluate the planned
[CrowdSec integration](https://github.com/RentnerKev/RentnerProxy/issues/64) and
[Forward Auth access policies](https://github.com/RentnerKev/RentnerProxy/issues/65) within the
existing Caddy architecture; these are planned work, not current feature claims.

Complete the [security review](https://github.com/RentnerKev/RentnerProxy/issues/72),
[backup/restore compatibility work](https://github.com/RentnerKev/RentnerProxy/issues/71), and
[accessibility and UX review](https://github.com/RentnerKev/RentnerProxy/issues/74). The Beta gate
also calls for upgrade, reliability, scale/concurrency, fresh-install, and published-image
verification. Open issues are work to complete or defer, not evidence that these reviews passed.

## Beta stabilization and stable release preparation

After Beta 1, generally stop large new v1 features and prioritize bugs, compatibility, performance,
stability, and tester feedback, as specified by the Beta gate. Keep installation, recovery,
architecture, and security documentation aligned with the code. Prepare a stable release only
when the maintainer judges the evidence sufficient; the current
[release process and its limitations](RELEASING.md) still apply.

## Maintenance if 1.0 is reached

Continue vulnerability triage, dependency updates, regression fixes, and upgrade/recovery
verification. Clarify supported versions in [SECURITY.md](SECURITY.md) when the actual support
policy changes. Until then, that policy supports the latest `main`, not older snapshots.

## Outside this planning horizon's intended scope

Keep one Caddy data plane and the controller-owned ACME/certificate boundary. Do not plan a second
proxy engine, a generic plugin marketplace, a full SIEM, or an unrelated analytics platform.
These limits follow the existing contribution rules and CrowdSec issue scope. Badge work does not
justify replacing core architecture, and this roadmap does not promise reproducible builds,
cryptographic release signing, measured 80% coverage, or additional maintainers.

Priorities and changes are decided through [GOVERNANCE.md](GOVERNANCE.md). Contributions follow
[CONTRIBUTING.md](CONTRIBUTING.md).

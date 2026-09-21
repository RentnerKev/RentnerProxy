# Roadmap

[`v1.0.0-alpha.6`](https://github.com/RentnerKev/RentnerProxy/releases/tag/v1.0.0-alpha.6)
is the current public alpha. The next milestone is
[Beta 1](https://github.com/RentnerKev/RentnerProxy/milestone/4).

This roadmap covers September 2026 through September 2027. It describes intended direction, not
promised delivery dates. Phases may overlap or take longer depending on tester feedback, release
blockers, and the capacity of the single maintainer. Reaching beta or 1.0 during this period is
not guaranteed.

## Current public alpha

Alpha 6 is published. Current alpha work is limited to hardening the existing Caddy appliance,
host and redirect configuration, certificate lifecycle, live administration, and
upgrade/recovery paths described in [`README.md`](README.md). The focus is on reported defects,
compatibility, and regression coverage rather than another runtime redesign.

Completed Alpha 6 work is part of the current baseline and is not listed below as unfinished
roadmap scope.

## Planned Beta 1 features

The following capabilities are planned, not currently available:

- [CrowdSec integration](https://github.com/RentnerKev/RentnerProxy/issues/64).
- [Forward Auth access policies](https://github.com/RentnerKev/RentnerProxy/issues/65).
- [Nginx Proxy Manager importer](https://github.com/RentnerKev/RentnerProxy/issues/66).

Each feature must fit the existing Caddy and desired-state/controller architecture. The Beta 1
gate decides what must ship and what can be explicitly deferred.

## Beta readiness and release gate

Before Beta 1, the project plans to complete or explicitly disposition:

- [Alpha-to-Beta upgrade hardening](https://github.com/RentnerKev/RentnerProxy/issues/67) and a
  [release compatibility matrix](https://github.com/RentnerKev/RentnerProxy/issues/68).
- [Long-running runtime reliability](https://github.com/RentnerKev/RentnerProxy/issues/69) and
  [scale/concurrency testing](https://github.com/RentnerKev/RentnerProxy/issues/70).
- [Backup/restore compatibility](https://github.com/RentnerKev/RentnerProxy/issues/71).
- The [v1 Beta security review](https://github.com/RentnerKev/RentnerProxy/issues/72).
- The [accessibility and UX review](https://github.com/RentnerKev/RentnerProxy/issues/74).
- The final [Beta 1 release gate](https://github.com/RentnerKev/RentnerProxy/issues/75),
  including fresh-install and published-image verification.

Open issues are work to complete or defer, not evidence that a review has passed. Tester feedback
continues to inform all of these areas.

## Beta stabilization and stable release preparation

After Beta 1, generally stop large new v1 features and prioritize bugs, compatibility,
performance, reliability, and tester feedback. Keep installation, recovery, architecture, and
security documentation aligned with the code. Prepare a stable release only when the maintainer
judges the evidence sufficient; the current
[release process and its limitations](RELEASING.md) still apply.

## Maintenance if 1.0 is reached

Continue vulnerability triage, dependency updates, regression fixes, and upgrade/recovery
verification. Clarify supported versions in [`SECURITY.md`](SECURITY.md) when the actual support
policy changes. Until then, that policy supports the latest `main`, not older snapshots.

## Outside this planning horizon's intended scope

Keep one Caddy data plane and the controller-owned ACME/certificate boundary. Do not plan a
second proxy engine, DDNS, WireGuard, Docker discovery, a generic plugin marketplace, a full
SIEM, or an unrelated analytics platform as Beta 1 requirements. The roadmap also does not
promise reproducible builds, cryptographic release signing, measured 80% coverage, additional
maintainers, or a fixed release date.

Priorities and changes are decided through [`GOVERNANCE.md`](GOVERNANCE.md). Contributions follow
[`CONTRIBUTING.md`](CONTRIBUTING.md).

# Releasing

The maintainer coordinates releases under [GOVERNANCE.md](GOVERNANCE.md). This document describes
[release.yml](.github/workflows/release.yml), the reusable
[release pipeline](.github/workflows/release-pipeline.yml), and
[release-notes.ts](.github/scripts/release-notes.ts). It does not initiate a release.

## Before publication

Choose the intended commit and check its CI, security analysis, and Production Smokes results.
Follow the [contribution checks](CONTRIBUTING.md#testing-policy) and the applicable release-gate
issue; the [Beta 1 gate](https://github.com/RentnerKev/RentnerProxy/issues/75) is still planned work.
Review installation, upgrade, recovery, and known limitations for the chosen version.
The Valkey migration is a breaking deployment change tracked by #148. Verify the required
`RENTNERPROXY_IMAGE` Compose selector, the development `REDIS_URL` to `VALKEY_URL` rename, the
Foundation health response's `redis` to `valkey` field change, and
the Redis-based Alpha-to-Valkey upgrade/rollback instructions. Cache state remains transient;
historical v4 backup metadata stays compatible. Release notes must call out the required
configuration changes and include fresh-install, upgrade, backup/restore and reliability evidence
for the exact Valkey target commit.
For Beta 1, run [Release Compatibility](.github/workflows/release-compatibility.yml) manually
with `source=all` on the intended release ref before publication. Verify that fresh installation
and all six published Alpha image upgrades pass, that the logged target SHA is the intended
release commit, and that each source digest matches the pinned
[matrix](scripts/release-compatibility/published-alphas.ts). Keep the run URL with the release
evidence. The path-filtered pull request run checks fresh installation and Alpha 6; the weekly
historical run does not replace this exact-commit release gate.

Run [Runtime Scale](.github/workflows/runtime-scale.yml) on the exact intended release ref with
100 hosts, concurrency 4, three rounds and seed 70. Retain its run URL and sanitized JSON report;
require `summary.passed=true` and `steadyStateResources.trendEvidence=comparable`. The report must
identify the intended commit and built image. This bounded fixture covers configuration growth,
concurrent management operations, shipped Beta integrations and interruption/restart recovery.
Its short final resource samples do not replace release-duration evidence or establish a production
capacity guarantee. See [README.md](README.md#proxy-scale-and-concurrency-checks) for workload bounds.

Run [Runtime Reliability](.github/workflows/runtime-reliability.yml) manually with `profile=long`
and `source=all` on the exact intended release ref. Retain the run URL and both sanitized JSON
reports; require `summary.passed=true`, `summary.requestedDurationReached=true` and
`resources.trendEvidence=comparable` for current and immutable Alpha 6, with resource capture enabled.
The current report must have an empty `knownLimitations` list and complete certificate binding after
one retry. Alpha 6 may disclose `alpha6-binding-retry-needs-second-request`: only its exact known
stranded-job state permits one bounded second retry for the same job. That baseline pass accounts for
an additional operator action; it does not demonstrate automatic recovery in the published image.
The iteration limit may end a successful run early, so increase it within the documented bounds when
needed to reach the requested duration. Weekly runs and short PR checks do not replace
this exact-ref evidence. These fixture results do not establish universal production capacity.
Release readiness and publication remain the separate [Beta 1 gate](https://github.com/RentnerKev/RentnerProxy/issues/75);
this reliability work does not create a release.

The release workflow validates release identity and builds the tagged source. It does not itself
run the complete CI suite or verify that every release-gate issue is closed. Checking readiness
before publication is the maintainer's responsibility.

## Trigger and channels

Publish a GitHub Release for the intended tag. A tag push alone does not trigger this workflow;
the trigger is `release: published`. The tag must be a supported `v`-prefixed semantic version
without build metadata. Alpha and beta releases must be marked as GitHub pre-releases; stable
versions must not be marked as pre-releases.

| Example tag      | GitHub pre-release | Moving container tag |
| ---------------- | ------------------ | -------------------- |
| `v1.0.0-alpha.6` | Yes                | `alpha`              |
| `v1.0.0-beta.1`  | Yes                | `beta`               |
| `v1.0.0`         | No                 | `latest`             |

Examples illustrate accepted syntax, not releases to publish now. Releases are serialized by the
workflow's `release` concurrency group.

## Automated pipeline

1. Validate the tag, channel, release ID, publication timestamp, and GitHub pre-release state.
   Check out release automation at the workflow commit and source at the exact release tag.
2. Verify that the source commit matches the tag, that the production Docker inputs exclude
   environment and key files, and that the channel banner exists. Generate notes from eligible
   closed issues and the prior release window using
   [release-notes.json](.github/release-notes.json). Pull requests and excluded issues do
   not automatically become release-note entries. Review the resulting notes for omissions.
3. Build `docker/production/Dockerfile` for `linux/amd64`, with the release version as a build
   argument. Publish `ghcr.io/rentnerkev/rentnerproxy` under the exact version tag and the moving
   channel tag. Buildx is configured to emit an SBOM and maximum-mode provenance. Verify that both
   tags resolve to the build's reported digest.
4. Revalidate GitHub release identity, upload the channel banner and
   `RentnerProxy-<tag>-CHANGELOG.md` asset, and replace the release body with generated notes.
   Prepared assets are retained as a workflow artifact for 30 days. No root CHANGELOG.md is created.

Afterward, check all jobs, the published image, assets, and release notes. The GitHub Release
already exists when the workflow starts: a failed run can leave a published release incomplete,
or an image published before notes are updated. Inspect the failed stage before retrying through
GitHub Actions; do not assume publication was atomic. The pipeline can replace existing assets
and image tags on a rerun, so an exact version tag is not a cryptographic immutability guarantee.

## User verification and security limits

Download from the project's [GitHub Releases](https://github.com/RentnerKev/RentnerProxy/releases)
and GHCR repository. For deployment, retain the resolved image digest with the version and backup
records; a digest identifies content but does not authenticate a release signer. Follow
[README.md](README.md#images-and-upgrades) for upgrades and rollback rather than running an old image against
an upgraded database.

The current workflow does not cryptographically sign release images or assets, require signed
version tags, or provide a public signing-key and signature-verification procedure. Buildx
provenance and SBOM generation do not establish those guarantees. Bit-for-bit repeatable or
reproducible builds are not demonstrated or enforced by this pipeline.

A future security improvement would be authenticated release signing with documented verification
and separately verified build reproducibility. Neither is implemented by this documentation.
See [ASSURANCE_CASE.md](ASSURANCE_CASE.md) for the current security argument and residual risks,
and [SECURITY.md](SECURITY.md) for reporting problems.

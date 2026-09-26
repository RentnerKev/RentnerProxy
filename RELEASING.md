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
[README.md](README.md#upgrade) for upgrades and rollback rather than running an old image against
an upgraded database.

The current workflow does not cryptographically sign release images or assets, require signed
version tags, or provide a public signing-key and signature-verification procedure. Buildx
provenance and SBOM generation do not establish those guarantees. Bit-for-bit repeatable or
reproducible builds are not demonstrated or enforced by this pipeline.

A future security improvement would be authenticated release signing with documented verification
and separately verified build reproducibility. Neither is implemented by this documentation.
See [ASSURANCE_CASE.md](ASSURANCE_CASE.md) for the current security argument and residual risks,
and [SECURITY.md](SECURITY.md) for reporting problems.

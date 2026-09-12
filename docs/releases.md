# Release channels

Published GitHub releases are built from the exact release tag and publish an immutable Docker
image tag. The release pipeline also updates one moving channel tag:

| Release tag      | Channel | Moving Docker tag | GitHub pre-release |
| ---------------- | ------- | ----------------- | ------------------ |
| `v1.2.3-alpha.1` | Alpha   | `:alpha`          | Yes                |
| `v1.2.3-beta.1`  | Beta    | `:beta`           | Yes                |
| `v1.2.3`         | Stable  | `:latest`         | No                 |

Use the full image name `ghcr.io/rentnerkev/rentnerproxy:<tag>`. Exact version tags pin a release;
moving tags follow the most recently published release in their channel. The `:dev` channel is
retired. Pull request preview tags remain separate and are intended for isolated testing.

## Tag rules

Release tags use semantic versioning with an optional prerelease suffix. Only `alpha` and `beta`
prerelease channels are supported; other suffixes are rejected. Numeric prerelease identifiers
cannot have leading zeroes. The release channel and GitHub pre-release flag must agree with the tag.

Alpha, beta, and stable releases use their own release banner. The release pipeline checks the
banner, checks out the authoritative tag, validates the production Docker context, generates
release notes, and publishes the immutable and channel tags.

## Preparing a release

Merge the release changes through reviewed pull requests with every required check green.
Verify fresh installation, the previous release's real appliance upgrade, backup/restore and
security scans on the final `main` commit. Resolve or explicitly defer the milestone's issues.

Create an annotated version tag on that commit, then publish the matching GitHub release as a
pre-release for Alpha or Beta. Stable releases must not be marked as pre-releases. Verify the
pipeline, immutable image digest, source revision and release assets together before marking
the release complete. Keep a backup and follow the [upgrade and recovery guide](./upgrades.md).

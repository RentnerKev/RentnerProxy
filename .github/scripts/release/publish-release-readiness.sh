#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Recheck the original published event after the image, assets, and body succeeded.
bash "$script_directory/verify-release-identity.sh"
bun --no-env-file "$script_directory/verify-exact-revision-ci.ts"
bash "$script_directory/verify-release-identity.sh"
bun --no-env-file "$script_directory/generate-release-readiness.ts"
gh release upload "$RELEASE_TAG" \
    "$RUNNER_TEMP/rentnerproxy-release/rentnerproxy-update.json" \
    --clobber \
    --repo "$GITHUB_REPOSITORY" || {
    echo "::error::Publishing the release readiness asset failed."
    exit 1
}

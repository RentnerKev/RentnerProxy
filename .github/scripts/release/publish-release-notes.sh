#!/usr/bin/env bash
set -Eeuo pipefail
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
artifact_directory="$RUNNER_TEMP/rentnerproxy-release"

release_state="$(
    gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" \
        --jq '[.id, .tag_name, .draft, .prerelease, .published_at] | @tsv'
)" || {
    echo "::error::The release from the published event is no longer available."
    exit 1
}
IFS=$'\t' read -r actual_id actual_tag is_draft is_prerelease published_at <<< "$release_state"
if [[ "$actual_id" != "$RELEASE_ID" || "$actual_tag" != "$RELEASE_TAG" || "$is_draft" != 'false' || "$is_prerelease" != "$RELEASE_PRERELEASE" || "$published_at" != "$RELEASE_PUBLISHED_AT" ]]; then
    echo "::error::GitHub release metadata changed while the release workflow was running."
    exit 1
fi

bash "$script_directory/publish-release-readiness.sh" --validate-only

shopt -s nullglob
contributor_assets=("$artifact_directory"/contributor-*.svg)
gh release upload "$RELEASE_TAG" \
    "$artifact_directory/release-banner.png" \
    "$artifact_directory/$CHANGELOG_FILENAME" \
    "${contributor_assets[@]}" \
    --clobber \
    --repo "$GITHUB_REPOSITORY" || {
    echo "::error::Uploading GitHub release assets failed."
    exit 1
}

bash "$script_directory/publish-release-readiness.sh"
bash "$script_directory/verify-release-identity.sh"

gh release edit "$RELEASE_TAG" \
    --notes-file "$artifact_directory/release-body.md" \
    --repo "$GITHUB_REPOSITORY" || {
    echo "::error::Updating the GitHub release body failed."
    exit 1
}

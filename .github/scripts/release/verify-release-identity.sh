#!/usr/bin/env bash
set -Eeuo pipefail
release_state="$(
    gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" \
        --jq '[.id, .tag_name, .draft, .prerelease, .published_at] | @tsv'
)" || {
    echo "::error::The release from the published event is no longer available."
    exit 1
}
IFS=$'\t' read -r actual_id actual_tag is_draft is_prerelease published_at <<< "$release_state"
if [[ "$actual_id" != "$RELEASE_ID" || "$actual_tag" != "$RELEASE_TAG" || "$is_draft" != 'false' || "$is_prerelease" != "$RELEASE_PRERELEASE" || "$published_at" != "$RELEASE_PUBLISHED_AT" ]]; then
    echo "::error::GitHub release metadata does not match the published event."
    exit 1
fi

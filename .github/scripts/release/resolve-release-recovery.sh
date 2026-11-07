#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${GITHUB_REPOSITORY:-}" != 'RentnerProxy/platform' ||
      "${GITHUB_EVENT_NAME:-}" != 'workflow_dispatch' ||
      "${GITHUB_REF:-}" != 'refs/heads/main' ||
      "${GITHUB_WORKFLOW_REF:-}" != 'RentnerProxy/platform/.github/workflows/release-recovery.yml@refs/heads/main' ]]; then
    echo '::error::Release recovery requires the trusted main-branch recovery workflow.'
    exit 1
fi
if [[ ! "${RELEASE_ID:-}" =~ ^[1-9][0-9]{0,15}$ ]] || (( RELEASE_ID > 9007199254740991 )); then
    echo '::error::Invalid original release identifier.'
    exit 1
fi
if [[ ! "${REVISION:-}" =~ ^[0-9a-f]{40}$ || ! "${AUTOMATION_REVISION:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo '::error::Invalid original source or trusted automation revision.'
    exit 1
fi
if [[ ! "${RELEASE_PUBLISHED_AT:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
   [[ "$(date --utc --date "$RELEASE_PUBLISHED_AT" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)" != "$RELEASE_PUBLISHED_AT" ]]; then
    echo '::error::Invalid original UTC publication timestamp.'
    exit 1
fi

case "${RELEASE_TAG:-}" in
    *-alpha|*-alpha.*) export RELEASE_CHANNEL=alpha ;;
    *-beta|*-beta.*) export RELEASE_CHANNEL=beta ;;
    *) export RELEASE_CHANNEL=stable ;;
esac
# Validate all supplied tag and identity fields before using them in external commands.
RELEASE_PRERELEASE=false
if [[ "$RELEASE_CHANNEL" == alpha ]]; then RELEASE_PRERELEASE=true; fi
export RELEASE_PRERELEASE
bash "$script_directory/validate-release-event.sh"

release_state="$(gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID" \
    --jq '[.id, .tag_name, .draft, .prerelease, .published_at] | @tsv')"
IFS=$'\t' read -r actual_id actual_tag is_draft actual_prerelease actual_published_at <<< "$release_state"
if [[ "$actual_id" != "$RELEASE_ID" || "$actual_tag" != "$RELEASE_TAG" || "$is_draft" != false ||
      "$actual_published_at" != "$RELEASE_PUBLISHED_AT" ]]; then
    echo '::error::The existing published release does not match the recovery request.'
    exit 1
fi
export RELEASE_PRERELEASE="$actual_prerelease"
bash "$script_directory/validate-release-event.sh"

if [[ "$(git -C "$AUTOMATION_DIRECTORY" rev-parse HEAD)" != "$AUTOMATION_REVISION" ]] ||
   ! git -C "$AUTOMATION_DIRECTORY" merge-base --is-ancestor "$REVISION" "$AUTOMATION_REVISION"; then
    echo '::error::Recovery source must belong to the trusted main-branch history.'
    exit 1
fi
bash "$script_directory/verify-tag-revision.sh"
export RELEASE_REVISION="$REVISION"
bun --no-env-file "$script_directory/verify-exact-revision-ci.ts"
# Fence release deletion/recreation and tag movement again before handing off to the pipeline.
bash "$script_directory/verify-release-identity.sh"
bash "$script_directory/verify-tag-revision.sh"

{
    printf 'release_id=%s\n' "$RELEASE_ID"
    printf 'release_tag=%s\n' "$RELEASE_TAG"
    printf 'revision=%s\n' "$REVISION"
    printf 'published_at=%s\n' "$RELEASE_PUBLISHED_AT"
    printf 'prerelease=%s\n' "$RELEASE_PRERELEASE"
    printf 'channel=%s\n' "$RELEASE_CHANNEL"
} >> "$GITHUB_OUTPUT"

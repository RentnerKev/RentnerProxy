#!/usr/bin/env bash
set -Eeuo pipefail
auth_directory="$RUNNER_TEMP/pr-preview-auth"
auth_file="$auth_directory/auth.json"
inspect_error="$RUNNER_TEMP/pr-preview-inspect-error"
oci_archive="$ARTIFACT_DIRECTORY/preview-image.tar"

# Re-derive the exact OCI identity after scanning, before any registry login.
# The trusted policy rejects missing, stale, blocked or mismatched assessments.
[[ "$SOURCE_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
actual_digest="sha256:$(skopeo inspect --raw "oci-archive:$oci_archive" | sha256sum | cut -d ' ' -f1)"
[[ "$actual_digest" == "$SOURCE_IMAGE_DIGEST" ]] || {
    echo '::error::Preview archive changed after validation.'
    exit 1
}
identity_report="$RUNNER_TEMP/dependency-preview-publish-identity.json"
jq --null-input --arg revision "$TESTED_SHA" --arg digest "$actual_digest" \
    '{revision:$revision,digest:$digest}' > "$identity_report"
bun --no-env-file trusted/.github/scripts/security/dependency-policy.ts \
    approved "${ASSESSED_REPORT:?Approved preview assessment required}" "$identity_report"

bun trusted/.github/scripts/deploy/pr-preview.ts revalidate
install -d -m 0700 "$auth_directory"
printf '%s' "$GHCR_TOKEN" | skopeo login \
    --authfile "$auth_file" \
    --password-stdin \
    --username "$GHCR_USERNAME" \
    ghcr.io

set +e
immutable_digest="$(
    skopeo inspect --authfile "$auth_file" --format '{{.Digest}}' \
        "docker://$IMMUTABLE_REFERENCE" 2> "$inspect_error"
)"
inspect_status=$?
set -e

if (( inspect_status == 0 )); then
    [[ "$immutable_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
        echo '::error::Existing immutable preview tag has no valid digest.'
        exit 1
    }
    existing_config="$(
        skopeo inspect --authfile "$auth_file" --config \
            "docker://$IMMUTABLE_REFERENCE"
    )"
    jq --exit-status \
        --arg source "https://github.com/$REPOSITORY" \
        --arg title 'RentnerProxy PR Preview' \
        --arg revision "$TESTED_SHA" \
        --arg version "$IMMUTABLE_TAG" \
        '.os == "linux" and
         .architecture == "amd64" and
         .config.Labels["org.opencontainers.image.title"] == $title and
         .config.Labels["org.opencontainers.image.source"] == $source and
         .config.Labels["org.opencontainers.image.revision"] == $revision and
         .config.Labels["org.opencontainers.image.version"] == $version' \
        <<< "$existing_config" > /dev/null || {
            echo '::error::Immutable preview tag collision detected.'
            exit 1
        }
    echo 'Immutable preview tag already exists; preserving its digest.'
elif grep --extended-regexp --ignore-case --quiet \
    'manifest unknown|name unknown|not found' "$inspect_error"; then
    # Recheck immediately before the first registry write. The PR can close
    # while the immutable tag inspection is in progress.
    bun trusted/.github/scripts/deploy/pr-preview.ts revalidate
    skopeo copy --preserve-digests \
        --authfile "$auth_file" \
        "oci-archive:$oci_archive" \
        "docker://$IMMUTABLE_REFERENCE"
    immutable_digest="$(
        skopeo inspect --authfile "$auth_file" --format '{{.Digest}}' \
            "docker://$IMMUTABLE_REFERENCE"
    )"
else
    echo '::error::Could not inspect the immutable preview tag.'
    sed 's/^/skopeo: /' "$inspect_error"
    exit 1
fi

[[ "$immutable_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo '::error::GHCR returned no valid immutable preview digest.'
    exit 1
}
IMMUTABLE_IMAGE_DIGEST="$immutable_digest" \
    bun trusted/.github/scripts/deploy/pr-preview.ts validate-digests

bun trusted/.github/scripts/deploy/pr-preview.ts revalidate
skopeo copy --preserve-digests \
    --authfile "$auth_file" \
    "docker://$IMAGE@$immutable_digest" \
    "docker://$MOVING_REFERENCE"
final_immutable_digest="$(
    skopeo inspect --authfile "$auth_file" --format '{{.Digest}}' \
        "docker://$IMMUTABLE_REFERENCE"
)"
moving_digest="$(
    skopeo inspect --authfile "$auth_file" --format '{{.Digest}}' \
        "docker://$MOVING_REFERENCE"
)"
IMMUTABLE_IMAGE_DIGEST="$final_immutable_digest" \
    MOVING_IMAGE_DIGEST="$moving_digest" \
    bun trusted/.github/scripts/deploy/pr-preview.ts validate-digests
bun trusted/.github/scripts/deploy/pr-preview.ts revalidate
printf 'digest=%s\n' "$final_immutable_digest" >> "$GITHUB_OUTPUT"

#!/usr/bin/env bash
set -Eeuo pipefail
: "${ARCHIVE:?}" "${EXPECTED_ARCHIVE_SHA256:?}" "${EXPECTED_DIGEST:?}" "${IMAGE:?}" "${IMAGE_TAGS:?}"
: "${AUTOMATION_DIRECTORY:?}" "${ASSESSED_REPORT:?}" "${IDENTITY_REPORT:?}"
[[ "$EXPECTED_ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] || exit 1
[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
[[ "$IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]] || exit 1
printf '%s  %s\n' "$EXPECTED_ARCHIVE_SHA256" "$ARCHIVE" | sha256sum --check --strict
actual_digest="sha256:$(skopeo inspect --raw "oci-archive:$ARCHIVE" | sha256sum | cut -d ' ' -f1)"
[[ "$actual_digest" == "$EXPECTED_DIGEST" ]] || exit 1
# Blocked/report-only records can never authorize registry access or copying.
bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts" \
    approved "$ASSESSED_REPORT" "$IDENTITY_REPORT"
jq --exit-status --arg digest "$EXPECTED_DIGEST" '.digest == $digest' "$IDENTITY_REPORT" > /dev/null
auth_file="$RUNNER_TEMP/dependency-publish-auth.json"
trap 'rm -f "$auth_file"' EXIT
printf '%s' "$GHCR_TOKEN" | skopeo login --authfile "$auth_file" --password-stdin --username "$GHCR_USERNAME" ghcr.io
while IFS= read -r tag; do
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || exit 1
    # Copy the locally assessed index, including SBOM/provenance attestations;
    # this operation does not execute the image or its build/source scripts.
    skopeo copy --all --preserve-digests --authfile "$auth_file" "oci-archive:$ARCHIVE" "docker://$IMAGE:$tag"
    published_digest="sha256:$(skopeo inspect --authfile "$auth_file" --raw "docker://$IMAGE:$tag" | sha256sum | cut -d ' ' -f1)"
    [[ "$published_digest" == "$EXPECTED_DIGEST" ]] || exit 1
done <<< "$IMAGE_TAGS"
printf 'digest=%s\n' "$EXPECTED_DIGEST" >> "$GITHUB_OUTPUT"

#!/usr/bin/env bash
set -Eeuo pipefail
artifact_directory="$RUNNER_TEMP/pr-preview-artifact"
oci_archive="$artifact_directory/preview-image.tar"
mkdir -p "$artifact_directory"

docker buildx build \
    --build-arg "RENTNERPROXY_BUILD_VERSION=$IMMUTABLE_TAG" \
    --file source/docker/production/Dockerfile \
    --label 'org.opencontainers.image.title=RentnerProxy PR Preview' \
    --label 'org.opencontainers.image.description=Unreviewed pull request preview for testing only.' \
    --label "org.opencontainers.image.source=https://github.com/$REPOSITORY" \
    --label "org.opencontainers.image.url=https://github.com/$REPOSITORY/pull/$PR_NUMBER" \
    --label "org.opencontainers.image.revision=$TESTED_SHA" \
    --label "org.opencontainers.image.version=$IMMUTABLE_TAG" \
    --label 'org.opencontainers.image.licenses=MIT' \
    --output "type=oci,dest=$oci_archive" \
    --platform "$PREVIEW_PLATFORM" \
    --provenance=false \
    --sbom=false \
    --tag "local/rentnerproxy-pr-preview:$IMMUTABLE_TAG" \
    source

test -s "$oci_archive" || {
    echo '::error::Preview build produced no OCI archive.'
    exit 1
}
archive_size="$(stat --format='%s' "$oci_archive")"
if (( archive_size > 4294967296 )); then
    echo '::error::Preview OCI archive exceeds the 4 GiB safety limit.'
    exit 1
fi

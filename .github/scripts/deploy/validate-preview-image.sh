#!/usr/bin/env bash
set -Eeuo pipefail
oci_archive="$ARTIFACT_DIRECTORY/preview-image.tar"
bun trusted/.github/scripts/deploy/pr-preview.ts validate-artifact

raw_manifest="$(skopeo inspect --raw "oci-archive:$oci_archive")"
media_type="$(jq --raw-output '.mediaType // empty' <<< "$raw_manifest")"
case "$media_type" in
    application/vnd.oci.image.manifest.v1+json)
        ;;
    application/vnd.oci.image.index.v1+json)
        jq --exit-status \
            '(.manifests | length) == 1 and
             .manifests[0].mediaType == "application/vnd.oci.image.manifest.v1+json" and
             .manifests[0].platform.os == "linux" and
             .manifests[0].platform.architecture == "amd64" and
             ((.manifests[0].platform.variant // "") == "")' \
            <<< "$raw_manifest" > /dev/null || {
                echo '::error::OCI index must contain exactly one linux/amd64 image.'
                exit 1
            }
        ;;
    *)
        echo '::error::Artifact is not an OCI image manifest or index.'
        exit 1
        ;;
esac

config="$(skopeo inspect --config "oci-archive:$oci_archive")"
jq --exit-status \
    --arg revision "$TESTED_SHA" \
    --arg source "https://github.com/$REPOSITORY" \
    --arg title 'RentnerProxy PR Preview' \
    --arg version "$IMMUTABLE_TAG" \
    '.os == "linux" and
     .architecture == "amd64" and
     .config.Labels["org.opencontainers.image.title"] == $title and
     .config.Labels["org.opencontainers.image.source"] == $source and
     .config.Labels["org.opencontainers.image.revision"] == $revision and
     .config.Labels["org.opencontainers.image.version"] == $version' \
    <<< "$config" > /dev/null

source_digest="$(
    skopeo inspect --format '{{.Digest}}' "oci-archive:$oci_archive"
)"
[[ "$source_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo '::error::OCI archive has no valid source image digest.'
    exit 1
}
printf 'source_digest=%s\n' "$source_digest" >> "$GITHUB_OUTPUT"

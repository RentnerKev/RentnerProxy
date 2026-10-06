#!/usr/bin/env bash
set -Eeuo pipefail
image="ghcr.io/${GITHUB_REPOSITORY,,}"
root_reports="$REPORT_DIRECTORY"
status=0
while IFS= read -r tag; do
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || exit 1
    mkdir -p "$root_reports/$tag"
    if ! skopeo inspect --raw "docker://$image:$tag" > "$root_reports/$tag/resolved-manifest.json"; then
        status=1
        continue
    fi
    digest="sha256:$(sha256sum "$root_reports/$tag/resolved-manifest.json" | cut -d ' ' -f1)"
    revision="$(skopeo inspect --override-os linux --override-arch amd64 --config "docker://$image@$digest" | jq --raw-output '.config.Labels["org.opencontainers.image.revision"]')"
    if ! IMAGE_SOURCE="docker://$image@$digest" REVISION="$revision" REPORT_DIRECTORY="$root_reports/$tag" \
        bash "$AUTOMATION_DIRECTORY/.github/scripts/security/scan-image.sh"; then status=1; fi
done < "$SUPPORTED_TAGS_FILE"
exit "$status"

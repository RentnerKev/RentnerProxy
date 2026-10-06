#!/usr/bin/env bash
set -Eeuo pipefail
trap 'exit 1' ERR
image="ghcr.io/${GITHUB_REPOSITORY,,}"
root_reports="$REPORT_DIRECTORY"
status=0
seen=0
while IFS= read -r tag; do
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || exit 1
    mkdir -p "$root_reports/$tag"
    ((seen += 1))
    if ! skopeo inspect --raw "docker://$image:$tag" > "$root_reports/$tag/resolved-manifest.json"; then
        status=1
        continue
    fi
    digest="sha256:$(sha256sum "$root_reports/$tag/resolved-manifest.json" | cut -d ' ' -f1)"
    revision="$(skopeo inspect --override-os linux --override-arch amd64 --config "docker://$image@$digest" | jq --raw-output '.config.Labels["org.opencontainers.image.revision"]')"
    result=0
    IMAGE_SOURCE="docker://$image@$digest" REVISION="$revision" REPORT_DIRECTORY="$root_reports/$tag" \
        bash "$AUTOMATION_DIRECTORY/.github/scripts/security/scan-image.sh" || result=$?
    if (( result == 3 )); then
        if ! jq --exit-status --arg revision "$revision" --arg digest "$digest" \
            '.verdict == "blocked" and .revision == $revision and .digest == $digest' \
            "$root_reports/$tag/blocked-assessment.json" > /dev/null; then
            status=1
        elif (( status == 0 )); then status=3
        fi
    elif (( result != 0 )); then status=1
    fi
done < "$SUPPORTED_TAGS_FILE"
(( seen > 0 )) || exit 1
exit "$status"

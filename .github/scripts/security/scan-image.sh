#!/usr/bin/env bash
set -Eeuo pipefail
# Foreign command failures cannot masquerade as a completed adverse assessment.
trap 'exit 1' ERR
: "${IMAGE_SOURCE:?}" "${REVISION:?}" "${REPORT_DIRECTORY:?}" "${AUTOMATION_DIRECTORY:?}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || exit 1
mkdir -p "$REPORT_DIRECTORY"
container=''
cleanup() {
    if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null || true; fi
    rm -f "$REPORT_DIRECTORY/runtime.tar"
}
trap cleanup EXIT
rm -f "$REPORT_DIRECTORY/assessment.json" "$REPORT_DIRECTORY/blocked-assessment.json"
manifest="$REPORT_DIRECTORY/manifest.json"
skopeo inspect --raw "$IMAGE_SOURCE" > "$manifest"
digest="sha256:$(sha256sum "$manifest" | cut -d ' ' -f1)"
skopeo inspect --override-os linux --override-arch amd64 --config "$IMAGE_SOURCE" > "$REPORT_DIRECTORY/config.json"
jq --exit-status --arg revision "$REVISION" '.os == "linux" and .architecture == "amd64" and .config.Labels["org.opencontainers.image.revision"] == $revision' "$REPORT_DIRECTORY/config.json" > /dev/null
jq --null-input --arg revision "$REVISION" --arg digest "$digest" '{revision:$revision,digest:$digest}' > "$REPORT_DIRECTORY/identity.json"
policy="$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts"
status=0
assess() {
    local result=0
    "$@" || result=$?
    if (( result != 0 && result != 3 )); then status=1
    elif (( result == 3 && status == 0 )); then status=3
    fi
}
# Convert as data; docker create is stopped and docker cp never starts services.
skopeo copy --override-os linux --override-arch amd64 "$IMAGE_SOURCE" "docker-archive:$REPORT_DIRECTORY/runtime.tar:local/rentnerproxy-security:scan"
docker load --input "$REPORT_DIRECTORY/runtime.tar"
container="$(docker create --entrypoint /bin/false local/rentnerproxy-security:scan)"
mkdir -p "$REPORT_DIRECTORY/locked-source/core" "$REPORT_DIRECTORY/locked-source/web"
docker cp "$container:/usr/share/rentnerproxy/security/Cargo.lock" "$REPORT_DIRECTORY/locked-source/core/Cargo.lock" \
    2> "$REPORT_DIRECTORY/cargo-lock-copy-diagnostics.txt"
locked_source_directory="$REPORT_DIRECTORY/locked-source"
controller_report_directory="$REPORT_DIRECTORY/controller"
SOURCE_DIRECTORY="$locked_source_directory" REPORT_DIRECTORY="$controller_report_directory" \
    assess bash "$AUTOMATION_DIRECTORY/.github/scripts/security/audit-cargo.sh"
docker cp "$container:/opt/rentnerproxy/web/bun.lock" "$REPORT_DIRECTORY/locked-source/web/bun.lock"
docker cp "$container:/opt/rentnerproxy/web/package.json" "$REPORT_DIRECTORY/locked-source/web/package.json"
SOURCE_DIRECTORY="$locked_source_directory/web" \
    assess bash "$AUTOMATION_DIRECTORY/.github/scripts/security/audit-bun.sh"
if (( status == 3 )); then
    bun --no-env-file "$policy" blocked "$REPORT_DIRECTORY/identity.json" "$REPORT_DIRECTORY/blocked-assessment.json"
    echo '::error::Own locked Cargo/Bun dependencies contain blocking advisories.'
elif (( status != 0 )); then
    echo '::error::Own locked Cargo/Bun assessment is incomplete or invalid.'
fi
if (( status != 0 )); then exit "$status"; fi
bun --no-env-file "$policy" identity "$REPORT_DIRECTORY/identity.json" "$REPORT_DIRECTORY/assessment.json"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' 'Own locked Cargo/Bun dependencies passed. External runtime components are outside the assessment scope; this result is not a full-image security approval.' >> "$GITHUB_STEP_SUMMARY"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"; fi

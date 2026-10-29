#!/usr/bin/env bash
set -Eeuo pipefail
# Foreign command failures cannot masquerade as a completed adverse assessment.
trap 'exit 1' ERR
: "${IMAGE_SOURCE:?}" "${REVISION:?}" "${REPORT_DIRECTORY:?}" "${AUTOMATION_DIRECTORY:?}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || exit 1
mkdir -p "$REPORT_DIRECTORY"
work_directory="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/rentnerproxy-image-inputs.XXXXXX")"
container=''
cleanup() {
    if [[ -n "$container" ]]; then docker rm -f --volumes "$container" >/dev/null || true; fi
    rm -rf -- "$work_directory"
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
skopeo copy --override-os linux --override-arch amd64 "$IMAGE_SOURCE" "docker-archive:$work_directory/runtime.tar:local/rentnerproxy-security:scan"
docker load --input "$work_directory/runtime.tar"
container="$(docker create --entrypoint /bin/false local/rentnerproxy-security:scan)"
locked_source_directory="$work_directory/locked-source"
mkdir -p "$locked_source_directory/core" "$locked_source_directory/web"
copy_input() {
    local source="$1" destination="$2" expected="$3"
    (
        ulimit -f 8192
        docker cp "$container:$source" - > "$work_directory/input.tar"
    )
    bash "$AUTOMATION_DIRECTORY/.github/scripts/security/extract-image-input.sh" \
        "$work_directory/input.tar" "$destination" "$expected"
    rm -f -- "$work_directory/input.tar"
}
copy_input /usr/share/rentnerproxy/security/Cargo.lock "$locked_source_directory/core/Cargo.lock" Cargo.lock \
    2> "$REPORT_DIRECTORY/cargo-lock-copy-diagnostics.txt"
controller_report_directory="$REPORT_DIRECTORY/controller"
SOURCE_DIRECTORY="$locked_source_directory" REPORT_DIRECTORY="$controller_report_directory" \
    assess bash "$AUTOMATION_DIRECTORY/.github/scripts/security/audit-cargo.sh"
copy_input /opt/rentnerproxy/web/bun.lock "$locked_source_directory/web/bun.lock" bun.lock
copy_input /opt/rentnerproxy/web/package.json "$locked_source_directory/web/package.json" package.json
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

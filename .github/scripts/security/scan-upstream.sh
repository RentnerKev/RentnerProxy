#!/usr/bin/env bash
set -Eeuo pipefail
# This subprocess reports upstream diagnostics only. The caller never uses its
# verdict to approve or reject the mandatory own Cargo/Bun dependency assessment.
trap 'exit 1' ERR
: "${IMAGE_SOURCE:?}" "${REVISION:?}" "${AUTOMATION_DIRECTORY:?}" "${RUNNER_TEMP:?}"
: "${CONTAINER:?}" "${REPORT_DIRECTORY:?}" "${PROFILE_PATH:?}" "${IDENTITY_PATH:?}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || exit 1
mkdir -p "$REPORT_DIRECTORY"
# Invoked by the EXIT trap so incomplete diagnostics still get a summary.
# shellcheck disable=SC2317,SC2329
finish() {
    local result=$? verdict
    rm -f "$REPORT_DIRECTORY/caddy" "$REPORT_DIRECTORY/crowdsec" "$REPORT_DIRECTORY/cscli"
    case "$result" in
        0) verdict='No findings under upstream diagnostic policy' ;;
        3) verdict='Upstream dependency advisories reported' ;;
        *) verdict='Upstream diagnostic coverage unavailable or incomplete' ;;
    esac
    printf '## Informational upstream dependency diagnostics\n\n%s. This result does not approve the image or change the own Cargo/Bun dependency gate. See the upstream report directory for scanner evidence.\n' \
        "$verdict" > "$REPORT_DIRECTORY/upstream-summary.md"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        cat "$REPORT_DIRECTORY/upstream-summary.md" >> "$GITHUB_STEP_SUMMARY"
    fi
}
trap 'finish' EXIT
policy="$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts"
jq --exit-status --arg revision "$REVISION" \
    '.revision == $revision and (.digest | test("^sha256:[0-9a-f]{64}$"))' "$IDENTITY_PATH" > /dev/null
jq --exit-status --raw-output '.goBinaries[] | [.name, .path] | @tsv' "$PROFILE_PATH" > "$REPORT_DIRECTORY/go-binaries.tsv"
community_module_query="$(jq --exit-status --raw-output '.communityModuleQuery | tostring' "$PROFILE_PATH")"
[[ "$community_module_query" == true || "$community_module_query" == false ]] || exit 1
export GRYPE_DB_CACHE_DIR="$RUNNER_TEMP/dependency-db"
export GRYPE_DB_VALIDATE_AGE=true GRYPE_DB_MAX_ALLOWED_BUILT_AGE=48h
export GRYPE_DB_REQUIRE_UPDATE_CHECK=true GRYPE_CHECK_FOR_APP_UPDATE=false
grype db update
grype db status --output json > "$REPORT_DIRECTORY/grype-db.json"
bun --no-env-file "$policy" database "$REPORT_DIRECTORY/grype-db.json"
scan_source="$IMAGE_SOURCE"
if [[ "$IMAGE_SOURCE" == docker://* ]]; then scan_source="registry:${IMAGE_SOURCE#docker://}"; fi
grype "$scan_source" --platform linux/amd64 --output json --file "$REPORT_DIRECTORY/image.json"
syft "$scan_source" --platform linux/amd64 --output "syft-json=$REPORT_DIRECTORY/inventory.json"
status=0
assess() {
    local result=0
    "$@" || result=$?
    if (( result != 0 && result != 3 )); then status=1
    elif (( result == 3 && status == 0 )); then status=3
    fi
}
assess bun --no-env-file "$policy" inventory "$REPORT_DIRECTORY/inventory.json" "$IDENTITY_PATH"
assess bun --no-env-file "$policy" image "$REPORT_DIRECTORY/image.json"
while IFS=$'\t' read -r binary binary_path; do
    # The profile is trusted automation data; constrain copied artifact names.
    [[ "$binary" == caddy || "$binary" == crowdsec || "$binary" == cscli ]] || exit 1
    [[ "$binary_path" == /* ]] || exit 1
    docker cp "$CONTAINER:$binary_path" "$REPORT_DIRECTORY/$binary"
    go version -m -json "$REPORT_DIRECTORY/$binary" > "$REPORT_DIRECTORY/$binary-buildinfo.json"
    govulncheck -mode=binary -scan=symbol -json "$REPORT_DIRECTORY/$binary" | jq --slurp . > "$REPORT_DIRECTORY/$binary-govulncheck.json"
    assess bun --no-env-file "$policy" binary "$REPORT_DIRECTORY/$binary-govulncheck.json"
done < "$REPORT_DIRECTORY/go-binaries.tsv"
if [[ "$community_module_query" == true ]]; then
    community_version="$(jq --raw-output '.Deps[] | select(.Path == "github.com/hslatman/caddy-crowdsec-bouncer") | .Version' "$REPORT_DIRECTORY/caddy-buildinfo.json")"
    [[ "$community_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] || exit 1
    govulncheck -mode=query -json "github.com/hslatman/caddy-crowdsec-bouncer@$community_version" | jq --slurp . > "$REPORT_DIRECTORY/community-govulncheck.json"
    assess bun --no-env-file "$policy" query "$REPORT_DIRECTORY/community-govulncheck.json"
fi
exit "$status"

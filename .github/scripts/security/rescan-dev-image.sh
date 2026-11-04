#!/usr/bin/env bash
set -Eeuo pipefail
trap 'exit 1' ERR
: "${GITHUB_REPOSITORY:?}" "${REPORT_DIRECTORY:?}" "${AUTOMATION_DIRECTORY:?}"
image="ghcr.io/${GITHUB_REPOSITORY,,}"
root_reports="$REPORT_DIRECTORY"
REPORT_DIRECTORY="$root_reports/dev"
mkdir -p "$REPORT_DIRECTORY"
summary="$root_reports/rescan-summary.md"
printf '%s\n' '## Deployed dependency assessment' '' \
    'The current dev Cargo/Bun gate is mandatory. External runtime components are outside the assessment scope. This report does not authorize image publication.' '' \
    '| Channel | Assessment | Source revision | Image digest |' \
    '| --- | --- | --- | --- |' > "$summary"
# Invoked by EXIT, including early scanner/evidence failures.
# shellcheck disable=SC2317,SC2329
finish_summary() {
    local result=$?
    if (( result == 0 )); then
        printf '\n**The current dev own-dependency gate passed.**\n' >> "$summary"
    elif (( result == 3 )); then
        printf '\n**Assessment complete: the dev image is blocked by own Cargo/Bun dependency advisories.**\n\nSee the per-platform bun-audit.json, controller/cargo.json and blocked-assessment.json reports under dev/. An immutable image requires a newly assessed replacement; rerunning the scan does not patch it.\n' >> "$summary"
    else
        printf '\n**Assessment incomplete or invalid: scanner or evidence errors require investigation.**\n' >> "$summary"
    fi
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$summary" >> "$GITHUB_STEP_SUMMARY"; fi
}
trap 'finish_summary' EXIT
record_result() {
    # Backticks are literal Markdown delimiters.
    # shellcheck disable=SC2016
    printf '| `dev` | %s | `%s` | `%s` |\n' "$1" "$2" "$3" >> "$summary"
}
# Resolve the mutable channel exactly once. Every subsequent operation uses its digest.
if ! skopeo inspect --raw "docker://$image:dev" > "$REPORT_DIRECTORY/resolved-manifest.json"; then
    echo '::error::Cannot resolve current dev image'
    record_result 'Incomplete: image resolution failed' '-' '-'
    exit 1
fi
digest="sha256:$(sha256sum "$REPORT_DIRECTORY/resolved-manifest.json" | cut -d ' ' -f1)"
if ! revision="$(skopeo inspect --override-os linux --override-arch amd64 --config "docker://$image@$digest" | jq --raw-output '.config.Labels["org.opencontainers.image.revision"] // empty')"; then
    echo '::error::Cannot read immutable dev image revision'
    record_result 'Incomplete: revision fetch failed' '-' "$digest"
    exit 1
fi
if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
    echo '::error::Missing or invalid immutable dev image revision'
    record_result 'Incomplete: revision missing or invalid' '-' "$digest"
    exit 1
fi
architectures="$(bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/security/image-platforms.ts" "$REPORT_DIRECTORY/resolved-manifest.json")"
[[ "$architectures" == amd64 || "$architectures" == $'amd64\narm64' ]]
jq --null-input --arg revision "$revision" --arg digest "$digest" \
    '{revision:$revision,digest:$digest}' > "$REPORT_DIRECTORY/resolved-identity.json"
policy="$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts"
assess_platform() {
    local architecture="$1" reports="$REPORT_DIRECTORY" prefix='' result=0
    if [[ "$architecture" == arm64 ]]; then reports="$REPORT_DIRECTORY/arm64"; prefix='ARM64 '; fi
    mkdir -p "$reports" || return 1
    IMAGE_SOURCE="docker://$image@$digest" IMAGE_ARCHITECTURE="$architecture" REVISION="$revision" REPORT_DIRECTORY="$reports" \
        bash "$AUTOMATION_DIRECTORY/.github/scripts/security/scan-image.sh" || result=$?
    if (( result == 3 )); then
        if ! bun --no-env-file "$policy" blocked-assessment "$reports/blocked-assessment.json" "$REPORT_DIRECTORY/resolved-identity.json"; then
            echo "::error::Invalid $architecture blocked dev assessment evidence"
            record_result "Incomplete: ${prefix}blocked evidence invalid" "$revision" "$digest"
            return 1
        fi
        echo "::error::Own dependency advisories block dev $architecture ($digest); inspect its blocked assessment and scanner reports."
        record_result "Blocked: ${prefix}own dependency advisories" "$revision" "$digest"
        return 3
    elif (( result != 0 )); then
        echo "::error::Incomplete $architecture dev dependency assessment"
        record_result "Incomplete: ${prefix}scanner or evidence error" "$revision" "$digest"
        return 1
    elif ! bun --no-env-file "$policy" approved "$reports/assessment.json" "$REPORT_DIRECTORY/resolved-identity.json"; then
        echo "::error::Invalid $architecture own-dependency dev approval evidence"
        record_result "Incomplete: ${prefix}approval evidence invalid" "$revision" "$digest"
        return 1
    fi
    record_result "${prefix}Own dependencies passed" "$revision" "$digest"
}
platforms=(amd64)
if [[ "$architectures" == $'amd64\narm64' ]]; then platforms+=(arm64); fi
status=0
for architecture in "${platforms[@]}"; do
    result=0
    assess_platform "$architecture" || result=$?
    if (( result != 0 && result != 3 )); then status=1
    elif (( result == 3 && status == 0 )); then status=3
    fi
done
exit "$status"

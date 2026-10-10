#!/usr/bin/env bash
set -Eeuo pipefail
trap 'exit 1' ERR
image="ghcr.io/${GITHUB_REPOSITORY,,}"
root_reports="$REPORT_DIRECTORY"
status=0
seen=0
seen_dev=false
mkdir -p "$root_reports"
summary="$root_reports/rescan-summary.md"
printf '%s\n' '## Deployed dependency assessment' '' \
    'The dev Cargo/Bun gate is mandatory. Historical release findings and upstream runtime diagnostics are informational. Incomplete own-dependency assessments remain failures. This report does not authorize image publication.' '' \
    '| Channel | Assessment | Source revision | Image digest |' \
    '| --- | --- | --- | --- |' > "$summary"
# Invoked by the EXIT trap, including early scanner/evidence failures.
# shellcheck disable=SC2317,SC2329
finish_summary() {
    local result=$?
    if (( result == 0 )); then
        printf '\n**The current dev own-dependency gate passed; historical and upstream reports are informational.**\n' >> "$summary"
    elif (( result == 3 )); then
        printf '\n**Assessment complete: the dev image is blocked by own Cargo/Bun dependency advisories.**\n\nSee dev/bun-audit.json and dev/controller/cargo.json. Existing immutable images require a newly assessed replacement; rerunning the scan does not patch them. Upstream evidence is retained separately.\n' >> "$summary"
    else
        printf '\n**Assessment incomplete or invalid: scanner or evidence errors require investigation.**\n' >> "$summary"
    fi
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then cat "$summary" >> "$GITHUB_STEP_SUMMARY"; fi
}
trap 'finish_summary' EXIT
record_result() {
    # Backticks are literal Markdown delimiters.
    # shellcheck disable=SC2016
    printf '| `%s` | %s | `%s` | `%s` |\n' "$1" "$2" "$3" "$4" >> "$summary"
}
while IFS= read -r tag; do
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || exit 1
    mkdir -p "$root_reports/$tag"
    ((seen += 1))
    if [[ "$tag" == dev ]]; then seen_dev=true; fi
    if ! skopeo inspect --raw "docker://$image:$tag" > "$root_reports/$tag/resolved-manifest.json"; then
        echo "::error::Cannot resolve monitored image $tag"
        record_result "$tag" 'Incomplete: image resolution failed' '-' '-'
        status=1
        continue
    fi
    digest="sha256:$(sha256sum "$root_reports/$tag/resolved-manifest.json" | cut -d ' ' -f1)"
    if ! revision="$(skopeo inspect --override-os linux --override-arch amd64 --config "docker://$image@$digest" | jq --raw-output '.config.Labels["org.opencontainers.image.revision"] // empty')"; then
        echo "::error::Cannot read immutable image revision for $tag"
        record_result "$tag" 'Incomplete: revision fetch failed' '-' "$digest"
        status=1
        continue
    fi
    if [[ ! "$revision" =~ ^[0-9a-f]{40}$ ]]; then
        echo "::error::Missing or invalid immutable image revision for $tag"
        record_result "$tag" 'Incomplete: revision missing or invalid' '-' "$digest"
        status=1
        continue
    fi
    result=0
    IMAGE_SOURCE="docker://$image@$digest" REVISION="$revision" REPORT_DIRECTORY="$root_reports/$tag" \
        bash "$AUTOMATION_DIRECTORY/.github/scripts/security/scan-image.sh" || result=$?
    jq --null-input --arg revision "$revision" --arg digest "$digest" \
        '{revision:$revision,digest:$digest}' > "$root_reports/$tag/resolved-identity.json"
    policy="$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts"
    if (( result == 3 )); then
        if ! bun --no-env-file "$policy" blocked-assessment \
            "$root_reports/$tag/blocked-assessment.json" "$root_reports/$tag/resolved-identity.json"; then
            echo "::error::Invalid blocked assessment evidence for $tag"
            record_result "$tag" 'Incomplete: blocked evidence invalid' "$revision" "$digest"
            status=1
        else
            if [[ "$tag" == dev ]]; then
                echo "::error::Own dependency advisories block dev ($digest); inspect dev/blocked-assessment.json and scanner reports."
                record_result "$tag" 'Blocked: own dependency advisories' "$revision" "$digest"
                if (( status == 0 )); then status=3; fi
            else
                echo "::warning::Historical release $tag ($digest) has own dependency advisories; informational because security fixes target current main."
                record_result "$tag" 'Informational: historical dependency advisories' "$revision" "$digest"
            fi
        fi
    elif (( result != 0 )); then
        echo "::error::Incomplete dependency assessment for $tag"
        record_result "$tag" 'Incomplete: scanner or evidence error' "$revision" "$digest"
        status=1
    elif ! bun --no-env-file "$policy" approved \
        "$root_reports/$tag/assessment.json" "$root_reports/$tag/resolved-identity.json"; then
        echo "::error::Invalid own-dependency approval evidence for $tag"
        record_result "$tag" 'Incomplete: approval evidence invalid' "$revision" "$digest"
        status=1
    else
        record_result "$tag" 'Own dependencies passed' "$revision" "$digest"
    fi
done < "$SUPPORTED_TAGS_FILE"
if (( seen == 0 )) || [[ "$seen_dev" != true ]]; then
    echo '::error::Monitored image tags must include dev'
    exit 1
fi
exit "$status"

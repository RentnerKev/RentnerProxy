#!/usr/bin/env bash
set -Eeuo pipefail
: "${AUTOMATION_DIRECTORY:?}" "${IMAGE_SOURCE:?}" "${REPORT_DIRECTORY:?}" "${REVISION:?}"
report_root=$REPORT_DIRECTORY
for architecture in amd64 arm64; do
    IMAGE_ARCHITECTURE="$architecture" REPORT_DIRECTORY="$report_root/$architecture" \
        bash "$AUTOMATION_DIRECTORY/.github/scripts/security/scan-image.sh"
done
cp "$report_root/amd64/identity.json" "$report_root/identity.json"
bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts" identity \
    "$report_root/identity.json" "$report_root/assessment.json"
printf 'digest=%s\n' "$(jq --raw-output .digest "$report_root/identity.json")" >> "$GITHUB_OUTPUT"

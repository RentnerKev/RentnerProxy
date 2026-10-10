#!/usr/bin/env bash
set -Eeuo pipefail
trap 'exit 1' ERR
: "${SOURCE_DIRECTORY:?}" "${REPORT_DIRECTORY:?}" "${AUTOMATION_DIRECTORY:?}"
mkdir -p "$REPORT_DIRECTORY"
sha256sum "$SOURCE_DIRECTORY/bun.lock" "$SOURCE_DIRECTORY/package.json" > "$REPORT_DIRECTORY/bun-lock.sha256"
# Package-manager commands can load .env despite --no-env-file. Audit only the
# exact lock/manifest data, without source deployment configuration or scripts.
audit_directory="$(mktemp -d "$REPORT_DIRECTORY/bun-audit-workspace.XXXXXX")"
cleanup() {
    rm -f -- "$audit_directory/bun.lock" "$audit_directory/package.json"
    rmdir -- "$audit_directory" || true
}
trap cleanup EXIT
cp -- "$SOURCE_DIRECTORY/bun.lock" "$SOURCE_DIRECTORY/package.json" "$audit_directory/"
status=0
(cd "$audit_directory" && bun --no-env-file audit --json --audit-level=moderate) \
    > "$REPORT_DIRECTORY/bun-audit.json" 2> "$REPORT_DIRECTORY/bun-audit-diagnostics.txt" || status=$?
printf '%s\n' "$status" > "$REPORT_DIRECTORY/bun-audit-status.txt"
cat "$REPORT_DIRECTORY/bun-audit-diagnostics.txt" >&2
policy_status=0
bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts" \
    bun-audit "$REPORT_DIRECTORY/bun-audit.json" "$status" "$REPORT_DIRECTORY/bun-audit-diagnostics.txt" || policy_status=$?
if (( policy_status == 3 )); then exit 3; fi
if (( policy_status != 0 )); then exit 1; fi

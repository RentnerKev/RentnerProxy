#!/usr/bin/env bash
set -Eeuo pipefail
# Only a validated policy result may use exit 3; external tools fail fatally.
trap 'exit 1' ERR
mkdir -p "$REPORT_DIRECTORY"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || exit 1
printf '%s\n' "$REVISION" > "$REPORT_DIRECTORY/source-revision.txt"
sha256sum "$SOURCE_DIRECTORY/core/Cargo.lock" > "$REPORT_DIRECTORY/cargo-lock.sha256"
# --locked authenticates the release dependency graph using registry checksums.
if [[ ! -x "$RUNNER_TEMP/cargo-audit/bin/cargo-audit" ]]; then
    cargo install cargo-audit --version 0.22.2 --locked --root "$RUNNER_TEMP/cargo-audit"
fi
database="$REPORT_DIRECTORY/rustsec-advisory-db"
git clone --depth=1 https://github.com/RustSec/advisory-db.git "$database"
status=0
# Fetch mode loads Git metadata AND refreshes the crates.io index. --no-fetch
# instead opens plain advisory files and suppresses index refresh in 0.22.2.
"$RUNNER_TEMP/cargo-audit/bin/cargo-audit" audit --file "$SOURCE_DIRECTORY/core/Cargo.lock" \
    --db "$database" --deny warnings --json > "$REPORT_DIRECTORY/cargo.json" \
    2> "$REPORT_DIRECTORY/cargo-diagnostics.txt" || status=$?
cat "$REPORT_DIRECTORY/cargo-diagnostics.txt" >&2
git -C "$database" rev-parse HEAD > "$REPORT_DIRECTORY/rustsec-revision.txt"
jq --null-input --arg revision "$(cat "$REPORT_DIRECTORY/rustsec-revision.txt")" \
    --arg fetchedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{revision:$revision,fetchedAt:$fetchedAt}' > "$REPORT_DIRECTORY/rustsec-database.json"
policy="$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts"
# Index refresh/per-crate errors can be printed without a nonzero scanner exit.
# Treat these diagnostics as an incomplete audit, never as a clean inventory.
bun --no-env-file "$policy" cargo-diagnostics "$REPORT_DIRECTORY/cargo-diagnostics.txt"
if (( status != 0 && status != 1 )); then exit 1; fi
policy_status=0
bun --no-env-file "$policy" cargo "$REPORT_DIRECTORY/cargo.json" "$REPORT_DIRECTORY/rustsec-database.json" || policy_status=$?
rm -rf "$database"
if (( policy_status == 3 )); then exit 3; fi
if (( policy_status != 0 || status != 0 )); then exit 1; fi

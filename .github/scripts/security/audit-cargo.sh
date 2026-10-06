#!/usr/bin/env bash
set -Eeuo pipefail
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
git -C "$database" rev-parse HEAD > "$REPORT_DIRECTORY/rustsec-revision.txt"
status=0
"$RUNNER_TEMP/cargo-audit/bin/cargo-audit" audit --file "$SOURCE_DIRECTORY/core/Cargo.lock" \
    --db "$database" --no-fetch --json > "$REPORT_DIRECTORY/cargo.json" || status=$?
if (( status > 1 )); then exit "$status"; fi
bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts" cargo "$REPORT_DIRECTORY/cargo.json"
rm -rf "$database"

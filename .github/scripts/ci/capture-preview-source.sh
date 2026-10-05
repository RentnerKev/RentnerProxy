#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]] || {
    echo '::error::GitHub did not provide a valid pull request number.'
    exit 1
}
[[ "$TESTED_SHA" =~ ^[0-9a-f]{40}$ ]] || {
    echo '::error::GitHub did not provide a valid tested merge SHA.'
    exit 1
}
proof_directory="$RUNNER_TEMP/pr-preview-source"
mkdir -p "$proof_directory"
printf '%s\n' "$PR_NUMBER" > "$proof_directory/pr-number.txt"
printf '%s\n' "$TESTED_SHA" > "$proof_directory/tested-sha.txt"

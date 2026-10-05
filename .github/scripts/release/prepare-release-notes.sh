#!/usr/bin/env bash
set -Eeuo pipefail
bun automation/.github/scripts/release/generate-release-notes.ts \
    --config automation/.github/release-notes.json \
    --output-dir "$RUNNER_TEMP/rentnerproxy-release"

[[ -s "$RUNNER_TEMP/rentnerproxy-release/release-body.md" ]] || {
    echo "::error::Release notes generator did not create a release body."
    exit 1
}
[[ -s "$RUNNER_TEMP/rentnerproxy-release/$CHANGELOG_FILENAME" ]] || {
    echo "::error::Release notes generator did not create a changelog asset."
    exit 1
}

#!/usr/bin/env bash
set -eo pipefail

archive="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
archive_path="$RUNNER_TEMP/$archive"
release_url="https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}"

curl --fail --location --proto '=https' --tlsv1.2 --output "$archive_path" "$release_url"
printf '%s  %s\n' "$GITLEAKS_SHA256" "$archive_path" | sha256sum --check --strict
tar -xzf "$archive_path" -C "$RUNNER_TEMP" gitleaks
"$RUNNER_TEMP/gitleaks" version

#!/usr/bin/env bash
set -Eeuo pipefail
sudo apt-get update
sudo apt-get install --yes --no-install-recommends skopeo
# Upstream diagnostics are optional; their installation cannot block own audits.
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! bash "$script_directory/install-upstream-tools.sh"; then
    echo '::warning::Optional upstream vulnerability tools unavailable; own Cargo/Bun audits remain mandatory.'
fi

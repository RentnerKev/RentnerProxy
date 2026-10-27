#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    printf '%s\n' 'cargo-audit installation requires Linux x86_64.' >&2
    exit 1
fi

archive=cargo-audit-x86_64-unknown-linux-gnu-v0.22.2.tgz
checksum=ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39
release_url="https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/$archive"
directory=$(mktemp -d "$RUNNER_TEMP/cargo-audit-install.XXXXXXXX")
trap 'rm -rf -- "$directory"' EXIT

curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 120 --retry 3 --retry-max-time 300 \
    --output "$directory/$archive" "$release_url"
printf '%s  %s\n' "$checksum" "$directory/$archive" | sha256sum --check --strict
tar -xzf "$directory/$archive" -C "$directory" --strip-components=1 \
    cargo-audit-x86_64-unknown-linux-gnu-v0.22.2/cargo-audit
install -d "$RUNNER_TEMP/cargo-audit/bin"
install -m 0755 "$directory/cargo-audit" "$RUNNER_TEMP/cargo-audit/bin/cargo-audit"

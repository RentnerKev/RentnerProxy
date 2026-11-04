#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(uname -s)" != Linux ]]; then
    printf '%s\n' 'cargo-audit installation requires Linux.' >&2
    exit 1
fi

case "$(uname -m)" in
    x86_64)
        target=x86_64-unknown-linux-gnu
        checksum=ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39
        ;;
    aarch64)
        target=aarch64-unknown-linux-gnu
        checksum=c6603814ddaa45e51263dafd31c0ac98808f688d26f7395804f9670b0fd599dd
        ;;
    *) printf '%s\n' 'Unsupported cargo-audit architecture.' >&2; exit 1 ;;
esac
archive="cargo-audit-$target-v0.22.2.tgz"
release_url="https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/$archive"
directory=$(mktemp -d "$RUNNER_TEMP/cargo-audit-install.XXXXXXXX")
trap 'rm -rf -- "$directory"' EXIT

curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 120 --retry 3 --retry-max-time 300 \
    --output "$directory/$archive" "$release_url"
printf '%s  %s\n' "$checksum" "$directory/$archive" | sha256sum --check --strict
tar -xzf "$directory/$archive" -C "$directory" --strip-components=1 \
    "cargo-audit-$target-v0.22.2/cargo-audit"
install -d "$RUNNER_TEMP/cargo-audit/bin"
install -m 0755 "$directory/cargo-audit" "$RUNNER_TEMP/cargo-audit/bin/cargo-audit"

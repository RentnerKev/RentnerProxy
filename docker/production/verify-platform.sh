#!/bin/sh
set -eu

target_os=${1:?Usage: verify-platform.sh OS ARCH BINARY...}
target_arch=${2:?Usage: verify-platform.sh OS ARCH BINARY...}
shift 2
test "$#" -gt 0
case "$target_os/$target_arch" in
    linux/amd64) machine=3e00 ;;
    linux/arm64) machine=b700 ;;
    *) echo 'Unsupported appliance platform' >&2; exit 1 ;;
esac
test "$(dpkg --print-architecture)" = "$target_arch"

for binary do
    # Require little-endian ELF64 and the actual target CPU, including copied binaries.
    test "$(od -An -tx1 -N6 "$binary" | tr -d ' \n')" = 7f454c460201
    test "$(od -An -tx1 -j18 -N2 "$binary" | tr -d ' \n')" = "$machine"
    if linkage=$(ldd "$binary" 2>&1); then
        case "$linkage" in *'not found'*) echo "Missing runtime library: $binary" >&2; exit 1 ;; esac
    else
        case "$linkage" in
            *'not a dynamic executable'*|*'statically linked'*) ;;
            *) echo "Invalid runtime linkage: $binary" >&2; exit 1 ;;
        esac
    fi
done

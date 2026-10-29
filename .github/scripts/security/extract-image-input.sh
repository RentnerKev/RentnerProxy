#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
archive="${1:?}"
destination="${2:?}"
expected="${3:?}"
case "$expected" in Cargo.lock|bun.lock|package.json) ;; *) exit 1 ;; esac
[[ -f "$archive" && ! -L "$archive" && ! -e "$destination" && ! -L "$destination" ]] || exit 1
(( $(stat --format=%s -- "$archive") <= 8388608 )) || exit 1
entries="$(tar --list --file="$archive" --quoting-style=escape)"
[[ "$entries" == "$expected" ]] || exit 1
entry="$(tar --list --verbose --file="$archive" --quoting-style=escape)"
[[ "${entry:0:1}" == '-' ]] || exit 1
(
    set -C
    ulimit -f 4096
    tar --extract --to-stdout --file="$archive" -- "$expected" > "$destination"
)
[[ -f "$destination" && ! -L "$destination" && -s "$destination" ]] || exit 1
(( $(stat --format=%s -- "$destination") <= 4194304 )) || exit 1

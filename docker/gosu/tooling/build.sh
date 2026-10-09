#!/bin/sh
set -eu

script_root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
source_commit=6456aaa0f3c854d199d0f037f068eb97515b7513
source_sha256=33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b
output_root=${1:?Usage: build.sh ABSOLUTE_OUTPUT_DIRECTORY}
case "$output_root" in /*) ;; *) echo 'Output directory must be absolute' >&2; exit 1 ;; esac

export GOTOOLCHAIN=local
export GOPROXY=https://proxy.golang.org
export GOSUMDB=sum.golang.org
export GOFLAGS=-mod=readonly
export CGO_ENABLED=0
test "$(go env GOVERSION)" = go1.27.2
test "$(go env GOOS)" = linux

work_root=$(mktemp -d)
trap 'rm -rf "$work_root"' EXIT HUP INT TERM
curl --fail --location --retry 3 --output "$work_root/source.tar.gz" \
    "https://codeload.github.com/tianon/gosu/tar.gz/$source_commit"
printf '%s  %s\n' "$source_sha256" "$work_root/source.tar.gz" | sha256sum --check --strict -
mkdir "$work_root/source"
tar -xzf "$work_root/source.tar.gz" --strip-components=1 -C "$work_root/source"
cp "$script_root/go.mod" "$script_root/go.sum" "$work_root/source/"
cd "$work_root/source"
sha256sum go.mod go.sum > "$work_root/locks.sha256"
go mod download
go mod verify
sha256sum --check --strict "$work_root/locks.sha256"
mkdir -p "$output_root"
go build -trimpath -buildvcs=false -o "$output_root/gosu" .
sha256sum --check --strict "$work_root/locks.sha256"
go version -m "$output_root/gosu" > "$output_root/buildinfo.txt"
grep -Eq '^.*: go1\.27\.2$' "$output_root/buildinfo.txt"
grep -Eq 'dep[[:space:]]+github\.com/moby/sys/user[[:space:]]+v0\.4\.1[[:space:]]' "$output_root/buildinfo.txt"
grep -Eq 'build[[:space:]]+CGO_ENABLED=0$' "$output_root/buildinfo.txt"
test "$("$output_root/gosu" --version)" = '1.19 (go1.27.2 on linux/amd64; gc)'
test "$("$output_root/gosu" nobody id -u)" = 65534
test "$("$output_root/gosu" 10001:10002 id -u)" = 10001
test "$("$output_root/gosu" 10001:10002 id -g)" = 10002
cp LICENSE "$output_root/LICENSE"

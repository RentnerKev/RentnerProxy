#!/bin/sh
set -eu

# Run in the repository's pinned Go container with the repository mounted writable.
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
report=${1:-"$root/coverage/go"}
mkdir -p "$report"
report=$(CDPATH='' cd -- "$report" && pwd)
rm -f "$report/summary.json"
export GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=1
[ "$(go env GOVERSION)" = go1.27.3 ] || { echo 'Go coverage requires the pinned Go 1.27.3 toolchain' >&2; exit 2; }

cd "$root"
go test -race -count=1 -covermode=atomic -coverprofile="$report/checker.out" .github/scripts/ci/*.go
go vet .github/scripts/ci/*.go
[ -z "$(gofmt -l .github/scripts/ci/*.go)" ] || { echo 'Go coverage checker formatting differs' >&2; exit 1; }
go tool cover -func="$report/checker.out" > "$report/checker-functions.txt"

cd "$root/core/caddy-modules/responsecache"
go mod verify
go list -mod=readonly ./... > "$report/caddy-packages.txt"
go test -mod=readonly -race -count=1 -covermode=atomic -coverpkg=./... -coverprofile="$report/caddy.out" ./...
go vet -mod=readonly ./...
[ -z "$(gofmt -l .)" ] || { echo 'Caddy Go formatting differs' >&2; exit 1; }
go tool cover -func="$report/caddy.out" > "$report/caddy-functions.txt"
cd "$root/docker/tooling/buildinfo"
go test -race -count=1 -covermode=atomic -coverprofile="$report/buildinfo.out" ./*.go
go vet ./*.go
[ -z "$(gofmt -l .)" ] || { echo 'Build metadata Go formatting differs' >&2; exit 1; }
go tool cover -func="$report/buildinfo.out" > "$report/buildinfo-functions.txt"

go run "$root/.github/scripts/ci/go-coverage-check.go" --minimum 90 "$report"
printf '%s\n' 'Validated coverage profiles, package inventory and summary written to:' "$report"

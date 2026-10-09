#!/bin/sh
set -eu

# Full upstream v1.8.1 with the PostgreSQL driver migration and frozen module overlay.
script_root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
source_commit=909b5157986a2b2c2163300fdaef5ed01289f7d2
source_sha256=6a9219a2a2706e35b723750d581c697db54d32d1b3995216cc2838329e15f7dc
re2_version=2023-03-01
re2_sha256=7a9a4824958586980926a300b4717202485c4b4115ac031822e29aa4ef207e48
output_root=${1:?Usage: build.sh ABSOLUTE_OUTPUT_DIRECTORY}
case "$output_root" in /*) ;; *) echo 'Output directory must be absolute' >&2; exit 1 ;; esac

export GOTOOLCHAIN=local
export GOPROXY=https://proxy.golang.org
export GOSUMDB=sum.golang.org
export GOFLAGS=-mod=readonly
export CGO_ENABLED=1
test "$(go env GOVERSION)" = go1.27.2
test "$(go env GOOS)" = linux

work_root=$(mktemp -d)
trap 'rm -rf "$work_root"' EXIT HUP INT TERM
curl --fail --location --retry 3 --output "$work_root/re2.tar.gz" \
    "https://codeload.github.com/google/re2/tar.gz/refs/tags/$re2_version"
printf '%s  %s\n' "$re2_sha256" "$work_root/re2.tar.gz" | sha256sum --check --strict -
mkdir "$work_root/re2"
tar -xzf "$work_root/re2.tar.gz" --strip-components=1 -C "$work_root/re2"
make -C "$work_root/re2"
make -C "$work_root/re2" install
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig
test "$(pkg-config --variable=libdir re2)" = /usr/local/lib
test "$(pkg-config --variable=includedir re2)" = /usr/local/include
pkg-config --exists re2
curl --fail --location --retry 3 --output "$work_root/source.tar.gz" \
    "https://codeload.github.com/crowdsecurity/crowdsec/tar.gz/$source_commit"
printf '%s  %s\n' "$source_sha256" "$work_root/source.tar.gz" | sha256sum --check --strict -
mkdir "$work_root/source"
tar -xzf "$work_root/source.tar.gz" --strip-components=1 -C "$work_root/source"
/bin/sh "$script_root/patch-postgres.sh" "$work_root/source"
cp "$script_root/go.mod" "$script_root/go.sum" "$work_root/source/"
cd "$work_root/source"
sha256sum go.mod go.sum > "$work_root/locks.sha256"
go mod download
go mod verify
# Reject missing sums or any implicit lockfile changes, including during build.
sha256sum --check --strict "$work_root/locks.sha256"
go list -deps -tags netgo,osusergo,expr_debug,nomsgpack,sqlite_omit_load_extension,re2_cgo \
    ./cmd/crowdsec ./cmd/crowdsec-cli ./cmd/notification-* > "$work_root/packages.txt"
/bin/sh "$script_root/verify-packages.sh" "$work_root/packages.txt"
make build BUILD_VERSION=v1.8.1 BUILD_TAG="$source_commit" \
    BUILD_TIMESTAMP=2026-09-03_09:08:00 DOCKER_BUILD=1 \
    BUILD_PROFILE=default EXCLUDE= BUILD_SQLITE=mattn BUILD_RE2_WASM=0 BUILD_STATIC=1
sha256sum --check --strict "$work_root/locks.sha256"

mkdir -p "$output_root/bin" "$output_root/plugins" "$output_root/evidence"
for binary in crowdsec cscli; do
    case "$binary" in crowdsec) binary_path=cmd/crowdsec/crowdsec ;; cscli) binary_path=cmd/crowdsec-cli/cscli ;; esac
    go version -m "$binary_path" > "$output_root/evidence/$binary.buildinfo.txt"
    /bin/sh "$script_root/verify-buildinfo.sh" "$output_root/evidence/$binary.buildinfo.txt"
    # ldd exits nonzero for a static executable; validate that result explicitly.
    ldd_report=$(ldd "$binary_path" 2>&1 || true)
    printf '%s\n' "$ldd_report" > "$output_root/evidence/$binary.ldd.txt"
    case "$ldd_report" in
        *'not a dynamic executable'*|*'statically linked'*) ;;
        *) echo "Expected a fully static $binary, got: $ldd_report" >&2; exit 1 ;;
    esac
    cp "$binary_path" "$output_root/bin/$binary"
done
# Preserve the complete upstream notification-plugin build, too.
for plugin_dir in cmd/notification-*; do
    plugin_name=${plugin_dir##*/}
    cp "$plugin_dir/$plugin_name" "$output_root/plugins/$plugin_name"
done
cp go.mod go.sum "$output_root/evidence/"
cp "$work_root/packages.txt" "$output_root/evidence/packages.txt"
printf '%s\n' "$source_commit" > "$output_root/evidence/source-commit.txt"
printf '%s\n' "$source_sha256" > "$output_root/evidence/source-archive.sha256"

#!/bin/sh
set -eu

# Pristine upstream v1.8.1 with reviewed workspace pins and its SQLite appliance backend.
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
mkdir "$work_root/pins"
cp "$script_root/go.mod" "$script_root/go.sum" "$work_root/pins/"
cp "$script_root/go.work.template" "$work_root/go.work"
cp "$script_root/go.work.sum" "$work_root/go.work.sum"
export GOWORK="$work_root/go.work"
cd "$work_root"
sha256sum pins/go.mod pins/go.sum go.work go.work.sum > "$work_root/locks.sha256"
cd "$work_root/source"
# Hash every original source file, including upstream's untouched go.mod/go.sum.
find . -type f -print0 | sort -z | xargs -0 sha256sum > "$work_root/source-files.sha256"
go list -deps -tags netgo,osusergo,expr_debug,nomsgpack,sqlite_omit_load_extension,re2_cgo,no_db_postgres \
    ./cmd/crowdsec ./cmd/crowdsec-cli > "$work_root/packages.txt"
go mod verify
(cd "$work_root" && sha256sum --check --strict "$work_root/locks.sha256")
sha256sum --check --strict "$work_root/source-files.sha256" > /dev/null
/bin/sh "$script_root/verify-packages.sh" "$work_root/packages.txt"
# Both managed configurations use SQLite; upstream supports excluding just PostgreSQL.
make build BUILD_VERSION=v1.8.1 BUILD_TAG="$source_commit" \
    BUILD_TIMESTAMP=2026-09-03_09:08:00 DOCKER_BUILD=1 \
    BUILD_PROFILE=default EXCLUDE=db_postgres PLUGINS= BUILD_SQLITE=mattn BUILD_RE2_WASM=0 BUILD_STATIC=1
(cd "$work_root" && sha256sum --check --strict "$work_root/locks.sha256")
sha256sum --check --strict "$work_root/source-files.sha256" > /dev/null

mkdir -p "$output_root/bin" "$output_root/evidence"
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
cp "$work_root/pins/go.mod" "$work_root/pins/go.sum" \
    "$work_root/go.work" "$work_root/go.work.sum" \
    "$work_root/source-files.sha256" "$output_root/evidence/"
cp go.mod "$output_root/evidence/upstream.go.mod"
cp go.sum "$output_root/evidence/upstream.go.sum"
cp "$work_root/packages.txt" "$output_root/evidence/packages.txt"
printf '%s\n' "$source_commit" > "$output_root/evidence/source-commit.txt"
printf '%s\n' "$source_sha256" > "$output_root/evidence/source-archive.sha256"

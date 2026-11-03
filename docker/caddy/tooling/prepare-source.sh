#!/bin/sh
set -eu

# This backport is reviewed against this exact upstream release. A Caddy update
# must revalidate the patch and its request, listener and resource-lifetime tests.
[ "${CADDY_VERSION:-}" = v2.11.7 ] || { echo 'Caddy reload backport requires review for this version' >&2; exit 2; }
patch=/opt/rentnerproxy-caddy-patches/runtime-reload.patch
source="$(go env GOMODCACHE)/github.com/caddyserver/caddy/v2@$CADDY_VERSION"
target=/opt/rentnerproxy-caddy-source
test -f "$source/go.mod"
test ! -e "$target"
printf '%s  %s\n' 7ce04da49ae069b4ee3def2f3df29edb090524a35a025ac070c76004e42c3ae1 "$patch" | sha256sum -c -

# The caller verifies the upstream module before copying. Never patch the shared
# module cache: unit tests and other binaries must retain their original sources.
cp -R "$source" "$target"
chmod -R u+w "$target"
cd "$target"
git apply --check "$patch"
git apply "$patch"
cmp "$source/go.mod" go.mod
cmp "$source/go.sum" go.sum

#!/bin/bash
set -Eeuo pipefail
: "${PACKAGE_REPOSITORY_URL:?}" "${PACKAGE_SIGNING_FINGERPRINT:?}" "${TARGET:?}"
[[ "$PACKAGE_REPOSITORY_URL" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9_-]+)*/*$ ]] || exit 1
[[ "$PACKAGE_SIGNING_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]] || exit 1
[[ "$TARGET" == debian || "$TARGET" == fedora ]] || exit 1
channel=${RELEASE_CHANNEL:-beta}
[[ "$channel" == alpha || "$channel" == beta || "$channel" == stable ]] || exit 1
automation=$(cd -- "$(dirname -- "$0")/../../.." && pwd)
base=${PACKAGE_REPOSITORY_URL%/}
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
# Deliberately no GitHub token, registry login or signature-check bypass.
curl --fail --silent --show-error --location --proto '=https' "$base/keys/$PACKAGE_SIGNING_FINGERPRINT.asc" --output "$work/key.asc"
listing=$(gpg --batch --with-colons --show-keys "$work/key.asc")
[[ $(awk -F: '$1 == "pub" {count++} END {print count+0}' <<< "$listing") == 1 ]] || exit 1
actual=$(awk -F: '$1 == "fpr" {print $10; exit}' <<< "$listing")
[[ "$actual" == "$PACKAGE_SIGNING_FINGERPRINT" ]] || exit 1
curl --fail --silent --show-error --location --proto '=https' "$base/catalog.json" --output "$work/catalog.json"
curl --fail --silent --show-error --location --proto '=https' "$base/catalog.json.asc" --output "$work/catalog.json.asc"
gpg --batch --dearmor --output "$work/keyring.gpg" "$work/key.asc"
gpgv --keyring "$work/keyring.gpg" "$work/catalog.json.asc" "$work/catalog.json"
version=$(bun --no-env-file "$automation/.github/scripts/distribution/consumer.ts" version "$work")
package=rentnerproxy
if [[ "$TARGET" == debian ]]; then
    install -m 0644 "$work/keyring.gpg" /usr/share/keyrings/rentnerproxy.gpg
    printf 'deb [signed-by=/usr/share/keyrings/rentnerproxy.gpg] %s/apt %s main\n' "$base" "$channel" > /etc/apt/sources.list.d/rentnerproxy.list
    apt-get update -o APT::Update::Error-Mode=any
    cd "$work"
    if [[ -n "$version" ]]; then package="rentnerproxy=$version"; fi
    apt-get download "$package"
    dpkg-deb --field ./*.deb Package Version Architecture Depends
else
    install -m 0644 "$work/key.asc" /etc/pki/rpm-gpg/RENTNERPROXY
    cat > /etc/yum.repos.d/rentnerproxy.repo <<REPO
[rentnerproxy]
name=RentnerProxy published consumer
baseurl=$base/rpm/$channel/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RENTNERPROXY
REPO
    dnf --assumeyes --refresh makecache
    if [[ -n "$version" ]]; then package="rentnerproxy-$version.$(rpm --eval '%{_arch}')"; fi
    dnf --assumeyes download --destdir "$work" "$package"
    rpm --import "$work/key.asc"
    rpmkeys --checksig "$work"/*.rpm
fi
bun --no-env-file "$automation/.github/scripts/distribution/consumer.ts" verify "$work"

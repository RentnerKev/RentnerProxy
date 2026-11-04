#!/bin/bash
set -Eeuo pipefail
: "${PACKAGE_REPOSITORY_URL:?}" "${PACKAGE_SIGNING_FINGERPRINT:?}" "${TARGET:?}"
[[ "$PACKAGE_REPOSITORY_URL" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9_-]+)*/*$ ]] || exit 1
[[ "$PACKAGE_SIGNING_FINGERPRINT" =~ ^[A-F0-9]{40}$ ]] || exit 1
[[ "$TARGET" == debian || "$TARGET" == fedora ]] || exit 1
base=${PACKAGE_REPOSITORY_URL%/}
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
# Deliberately no GitHub token, registry login or signature-check bypass.
curl --fail --silent --show-error --location --proto '=https' "$base/keys/$PACKAGE_SIGNING_FINGERPRINT.asc" --output "$work/key.asc"
actual=$(gpg --batch --with-colons --show-keys "$work/key.asc" | awk -F: '$1 == "fpr" {print $10; exit}')
[[ "$actual" == "$PACKAGE_SIGNING_FINGERPRINT" ]] || exit 1
curl --fail --silent --show-error --location --proto '=https' "$base/catalog.json" --output "$work/catalog.json"
curl --fail --silent --show-error --location --proto '=https' "$base/catalog.json.asc" --output "$work/catalog.json.asc"
gpg --batch --dearmor --output "$work/keyring.gpg" "$work/key.asc"
gpgv --keyring "$work/keyring.gpg" "$work/catalog.json.asc" "$work/catalog.json"
if [[ "$TARGET" == debian ]]; then
    install -m 0644 "$work/keyring.gpg" /usr/share/keyrings/rentnerproxy.gpg
    printf 'deb [signed-by=/usr/share/keyrings/rentnerproxy.gpg] %s/apt %s main\n' "$base" "${RELEASE_CHANNEL:-beta}" > /etc/apt/sources.list.d/rentnerproxy.list
    apt-get update -o APT::Update::Error-Mode=any
    cd "$work"
    apt-get download rentnerproxy
    dpkg-deb --field ./*.deb Package Version Architecture Depends
else
    install -m 0644 "$work/key.asc" /etc/pki/rpm-gpg/RENTNERPROXY
    cat > /etc/yum.repos.d/rentnerproxy.repo <<REPO
[rentnerproxy]
name=RentnerProxy published consumer
baseurl=$base/rpm/${RELEASE_CHANNEL:-beta}/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RENTNERPROXY
REPO
    dnf --assumeyes --refresh makecache
    dnf --assumeyes download --destdir "$work" rentnerproxy
    rpm --import "$work/key.asc"
    rpmkeys --checksig "$work"/*.rpm
fi

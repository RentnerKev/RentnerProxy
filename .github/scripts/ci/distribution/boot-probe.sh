#!/bin/bash
set -Eeuo pipefail
sudo apt-get update
sudo apt-get install --yes --no-install-recommends systemd-container
work=$(mktemp -d "$RUNNER_TEMP/boot-probe-XXXXXXXX")
machine=rp-boot-probe
cleanup() {
    local result=$?
    sudo systemctl status "$machine.service" --no-pager --full || true
    sudo journalctl --unit "$machine.service" --no-pager --lines 100 || true
    sudo machinectl list || true
    sudo systemctl stop "$machine.service" || true
    exit "$result"
}
trap cleanup EXIT
docker build --file "docker/tooling/distribution/Dockerfile.$TARGET" --tag rp-boot-probe:fixture .
container=$(docker create rp-boot-probe:fixture)
docker export --output "$work/rootfs.tar" "$container"
mkdir "$work/rootfs"
sudo tar -xf "$work/rootfs.tar" -C "$work/rootfs"
sudo chown root:root "$work/rootfs"
sudo systemd-run --unit "$machine" --property=Delegate=yes --property=KillMode=mixed --collect systemd-nspawn --settings=no --keep-unit --boot --capability=CAP_NET_ADMIN --bind=/proc/sys/net --directory "$work/rootfs" --machine "$machine" --link-journal=no
for (( attempt=0; attempt<90; attempt++ )); do
    if sudo systemctl --machine "$machine" show --property Version > "$work/connected" 2> "$work/error"; then break; fi
    if sudo systemctl is-failed --quiet "$machine.service"; then cat "$work/error"; exit 1; fi
    (( attempt < 89 )) || { cat "$work/error"; exit 1; }
    sleep 1
done
cat "$work/connected"
sudo systemd-run --machine "$machine" --quiet --wait --pipe --collect --service-type=exec /usr/bin/podman info
sudo systemd-run --machine "$machine" --quiet --wait --pipe --collect --service-type=exec /usr/bin/podman run --rm mirror.gcr.io/library/alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a /bin/true

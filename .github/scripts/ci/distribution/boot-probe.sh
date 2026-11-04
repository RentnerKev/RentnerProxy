#!/bin/bash
set -Eeuo pipefail
sudo apt-get update
sudo apt-get install --yes --no-install-recommends systemd-container
work=$(mktemp -d "$RUNNER_TEMP/boot-probe-XXXXXXXX")
machine=rp-boot-probe
network=rp-boot-probe
created_network=false
cleanup() {
    local result=$?
    sudo systemctl status "$machine.service" --no-pager --full || true
    sudo journalctl --unit "$machine.service" --no-pager --lines 100 || true
    sudo machinectl list || true
    sudo systemctl stop "$machine.service" || true
    if [[ "$created_network" == true ]]; then
        sudo ip netns delete "$network" || true
        sudo ip link delete rp-host || true
    fi
    exit "$result"
}
trap cleanup EXIT
docker build --file "docker/tooling/distribution/Dockerfile.$TARGET" --tag rp-boot-probe:fixture .
container=$(docker create rp-boot-probe:fixture)
docker export --output "$work/rootfs.tar" "$container"
mkdir "$work/rootfs"
sudo tar -xf "$work/rootfs.tar" -C "$work/rootfs"
sudo chown root:root "$work/rootfs"
sudo ip netns add "$network"
created_network=true
sudo ip link add rp-host type veth peer name rp-guest
sudo ip addr add 192.0.2.1/30 dev rp-host
sudo ip link set rp-host up
sudo ip link set rp-guest netns "$network"
sudo ip -n "$network" link set lo up
sudo ip -n "$network" link set rp-guest name eth0
sudo ip -n "$network" addr add 192.0.2.2/30 dev eth0
sudo ip -n "$network" link set eth0 up
sudo ip -n "$network" route add default via 192.0.2.1
sudo sysctl --write net.ipv4.ip_forward=1
sudo iptables -t nat -A POSTROUTING -s 192.0.2.0/30 ! -o rp-host -j MASQUERADE
sudo iptables -I FORWARD -i rp-host -s 192.0.2.0/30 -j ACCEPT
sudo iptables -I FORWARD -o rp-host -d 192.0.2.0/30 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
sudo systemd-run --unit "$machine" --property=Delegate=yes --property=KillMode=mixed --collect systemd-nspawn --settings=no --keep-unit --boot --capability=CAP_NET_ADMIN --network-namespace-path="/run/netns/$network" --resolv-conf=copy-uplink --directory "$work/rootfs" --machine "$machine" --link-journal=no
for (( attempt=0; attempt<90; attempt++ )); do
    if sudo systemctl --machine "$machine" show --property Version > "$work/connected" 2> "$work/error"; then break; fi
    if sudo systemctl is-failed --quiet "$machine.service"; then cat "$work/error"; exit 1; fi
    (( attempt < 89 )) || { cat "$work/error"; exit 1; }
    sleep 1
done
cat "$work/connected"
sudo systemd-run --machine "$machine" --quiet --wait --pipe --collect --service-type=exec /usr/bin/podman info
sudo systemd-run --machine "$machine" --quiet --wait --pipe --collect --service-type=exec /usr/bin/podman run --rm mirror.gcr.io/library/alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a /bin/true

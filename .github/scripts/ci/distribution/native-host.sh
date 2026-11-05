#!/bin/bash
set -Eeuo pipefail
: "${DISTRIBUTION_DIRECTORY:?}" "${CANDIDATE_DIRECTORY:?}" "${SOURCE_DIRECTORY:?}" "${RUNNER_TEMP:?}" "${ARCHITECTURE:?}" "${TARGET:?}" "${EXPECTED_DIGEST:?}" "${ARCHIVE_SHA256:?}"
[[ "$ARCHITECTURE" == amd64 || "$ARCHITECTURE" == arm64 ]] || exit 1
[[ "$TARGET" == debian || "$TARGET" == fedora ]] || exit 1
case "$ARCHITECTURE/$(uname -m)" in amd64/x86_64|arm64/aarch64) ;; *) exit 1 ;; esac
[[ "$EXPECTED_DIGEST" =~ ^sha256:[a-f0-9]{64}$ && "$ARCHIVE_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 1
printf '%s  %s\n' "$ARCHIVE_SHA256" "$CANDIDATE_DIRECTORY/candidate-image.tar" | sha256sum --check --status
bun --no-env-file "$SOURCE_DIRECTORY/.github/scripts/distribution/prepare.ts" verify
work=$(mktemp -d "$RUNNER_TEMP/distribution-native-XXXXXXXX")
machine="rp-distribution-$TARGET-$ARCHITECTURE"
registry="rp-distribution-registry-$TARGET-$ARCHITECTURE"
rootfs="$work/rootfs"
exported=''
network="$machine"
created_network=false
created_veth=false
added_nat=false
added_outbound=false
added_return=false
cleanup() {
    local result=$?
    if (( result != 0 )); then
        sudo systemctl status "$machine.service" --no-pager --full || true
        sudo journalctl --unit "$machine.service" --no-pager --lines 100 || true
        sudo journalctl --directory "$rootfs/var/log/journal" --unit rentnerproxy.service --no-pager --lines 100 || true
    fi
    sudo systemctl stop "$machine.service" || true
    docker rm --force "$registry" >/dev/null 2>&1 || true
    if [[ -n "$exported" ]]; then docker rm --force "$exported" >/dev/null 2>&1 || true; fi
    if [[ -n ${server_pid:-} ]]; then kill "$server_pid" 2>/dev/null || true; fi
    if [[ "$added_return" == true ]]; then sudo iptables -D FORWARD -o rp-host -d 192.0.2.0/30 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT || true; fi
    if [[ "$added_outbound" == true ]]; then sudo iptables -D FORWARD -i rp-host -s 192.0.2.0/30 -j ACCEPT || true; fi
    if [[ "$added_nat" == true ]]; then sudo iptables -t nat -D POSTROUTING -s 192.0.2.0/30 ! -o rp-host -j MASQUERADE || true; fi
    if [[ "$created_veth" == true ]]; then sudo ip link delete rp-host || true; fi
    if [[ "$created_network" == true ]]; then sudo ip netns delete "$network" || true; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Keep the native guest's network namespace across its real PID 1 reboot. Only
# this disposable namespace receives writable network sysctls for netavark.
sudo ip netns add "$network"
created_network=true
sudo ip link add rp-host type veth peer name rp-guest
created_veth=true
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
added_nat=true
sudo iptables -I FORWARD -i rp-host -s 192.0.2.0/30 -j ACCEPT
added_outbound=true
sudo iptables -I FORWARD -o rp-host -d 192.0.2.0/30 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
added_return=true
docker run --detach --name "$registry" --network=host --env REGISTRY_HTTP_ADDR=192.0.2.1:15000 mirror.gcr.io/library/registry:3@sha256:d4032d4cc323c1731c707931ecada07a53076eac38e3b61ae57533f170f2c6c3 >/dev/null
for (( attempt=0; attempt<60; attempt++ )); do
    if curl --fail --silent http://192.0.2.1:15000/v2/ >/dev/null; then break; fi
    (( attempt < 59 )) || exit 1
    sleep 1
done
skopeo copy --all --preserve-digests --dest-tls-verify=false "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" docker://192.0.2.1:15000/rentnerkev/rentnerproxy:fixture
actual=$(skopeo inspect --raw --tls-verify=false "docker://192.0.2.1:15000/rentnerkev/rentnerproxy@$EXPECTED_DIGEST" | sha256sum)
[[ "sha256:${actual%% *}" == "$EXPECTED_DIGEST" ]] || exit 1
docker build --file "$SOURCE_DIRECTORY/scripts/smoke/http3/Dockerfile" --tag localhost/rentnerproxy-distribution-http3:fixture "$SOURCE_DIRECTORY"
docker save --output "$DISTRIBUTION_DIRECTORY/http3.tar" localhost/rentnerproxy-distribution-http3:fixture
docker build --file "$SOURCE_DIRECTORY/docker/tooling/distribution/Dockerfile.$TARGET" --tag "rp-distribution-$TARGET:fixture" "$SOURCE_DIRECTORY"
exported=$(docker create "rp-distribution-$TARGET:fixture")
mkdir "$rootfs"
docker export --output "$work/rootfs.tar" "$exported"
sudo tar --extract --file "$work/rootfs.tar" --directory "$rootfs"
sudo chown root:root "$rootfs"
# HTTP consumer traffic is anonymous. The fixture key and all packages are public test data.
python3 -m http.server 18888 --bind 192.0.2.1 --directory "$DISTRIBUTION_DIRECTORY" > "$work/http.log" 2>&1 & server_pid=$!
sudo systemd-run --unit "$machine" --property=Delegate=yes --property=KillMode=mixed --setenv=SYSTEMD_NSPAWN_API_VFS_WRITABLE=network --collect systemd-nspawn --settings=no --quiet --keep-unit --boot --capability=CAP_NET_ADMIN,CAP_BPF --system-call-filter='bpf @keyring' --network-namespace-path="/run/netns/$network" --resolv-conf=copy-uplink --directory "$rootfs" --machine "$machine" --link-journal=no --bind-ro="$DISTRIBUTION_DIRECTORY:/test" --bind-ro="$SOURCE_DIRECTORY:/automation"
for (( attempt=0; attempt<120; attempt++ )); do
    if sudo systemctl --machine "$machine" show --property Version >/dev/null 2>&1; then break; fi
    if sudo systemctl is-failed --quiet "$machine.service"; then exit 1; fi
    (( attempt < 119 )) || exit 1
    sleep 1
done
guest() {
    sudo systemd-run --machine "$machine" --quiet --wait --pipe --collect --service-type=exec --setenv="ARCHITECTURE=$ARCHITECTURE" --setenv="TARGET=$TARGET" --setenv="MODE=$mode" /bin/bash /automation/.github/scripts/ci/distribution/native-guest.sh "$1"
}
for mode in package quadlet; do
    guest install
    sudo cp "$rootfs/usr/bin/rentnerproxy" "$rootfs/root/quadlet-cli"
    boot=$(sudo machinectl show "$machine" --property=Leader --value)
    [[ "$boot" =~ ^[1-9][0-9]*$ ]] || exit 1
    sudo systemctl --machine "$machine" reboot
    for (( attempt=0; attempt<120; attempt++ )); do
        current=$(sudo machinectl show "$machine" --property=Leader --value 2>/dev/null || true)
        if [[ "$current" =~ ^[1-9][0-9]*$ && "$current" != "$boot" ]]; then break; fi
        (( attempt < 119 )) || exit 1
        sleep 1
    done
    guest after-boot
done
printf '{"schemaVersion":1,"architecture":"%s","target":"%s","digest":"%s","revision":"%s","version":"%s","runId":"%s","runAttempt":%s,"passed":true}\n' "$ARCHITECTURE" "$TARGET" "$EXPECTED_DIGEST" "$REVISION" "$VERSION" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" > "$DISTRIBUTION_DIRECTORY/native-$TARGET-$ARCHITECTURE.json"

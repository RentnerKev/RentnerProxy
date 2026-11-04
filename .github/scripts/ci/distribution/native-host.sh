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
cleanup() {
    local result=$?
    sudo systemctl stop "$machine.service" || true
    docker rm --force "$registry" >/dev/null 2>&1 || true
    if [[ -n "$exported" ]]; then docker rm --force "$exported" >/dev/null 2>&1 || true; fi
    if [[ -n ${server_pid:-} ]]; then kill "$server_pid" 2>/dev/null || true; fi
    exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker run --detach --name "$registry" --network=host --env REGISTRY_HTTP_ADDR=127.0.0.1:15000 mirror.gcr.io/library/registry:3@sha256:d4032d4cc323c1731c707931ecada07a53076eac38e3b61ae57533f170f2c6c3 >/dev/null
for (( attempt=0; attempt<60; attempt++ )); do
    if curl --fail --silent http://127.0.0.1:15000/v2/ >/dev/null; then break; fi
    (( attempt < 59 )) || exit 1
    sleep 1
done
skopeo copy --all --preserve-digests --dest-tls-verify=false "oci-archive:$CANDIDATE_DIRECTORY/candidate-image.tar" docker://127.0.0.1:15000/rentnerkev/rentnerproxy:fixture
actual=$(skopeo inspect --raw --tls-verify=false "docker://127.0.0.1:15000/rentnerkev/rentnerproxy@$EXPECTED_DIGEST" | sha256sum)
[[ "sha256:${actual%% *}" == "$EXPECTED_DIGEST" ]] || exit 1
docker build --file "$SOURCE_DIRECTORY/scripts/smoke/http3/Dockerfile" --tag localhost/rentnerproxy-distribution-http3:fixture "$SOURCE_DIRECTORY"
docker save --output "$DISTRIBUTION_DIRECTORY/http3.tar" localhost/rentnerproxy-distribution-http3:fixture
docker build --file "$SOURCE_DIRECTORY/docker/tooling/distribution/Dockerfile.$TARGET" --tag "rp-distribution-$TARGET:fixture" "$SOURCE_DIRECTORY"
exported=$(docker create "rp-distribution-$TARGET:fixture")
mkdir "$rootfs"
docker export --output "$work/rootfs.tar" "$exported"
sudo tar --extract --file "$work/rootfs.tar" --directory "$rootfs"
# HTTP consumer traffic is anonymous. The fixture key and all packages are public test data.
python3 -m http.server 18888 --bind 127.0.0.1 --directory "$DISTRIBUTION_DIRECTORY" > "$work/http.log" 2>&1 & server_pid=$!
sudo systemd-run --unit "$machine" --property=Delegate=yes --property=KillMode=mixed --collect systemd-nspawn --settings=no --quiet --boot --directory "$rootfs" --machine "$machine" --link-journal=no --bind-ro="$DISTRIBUTION_DIRECTORY:/test" --bind-ro="$SOURCE_DIRECTORY:/automation"
for (( attempt=0; attempt<120; attempt++ )); do
    if sudo systemctl --machine "$machine" show --property Version >/dev/null 2>&1; then break; fi
    (( attempt < 119 )) || exit 1
    sleep 1
done
guest() {
    sudo systemd-run --machine "$machine" --quiet --wait --pipe --collect --service-type=exec --setenv="ARCHITECTURE=$ARCHITECTURE" --setenv="TARGET=$TARGET" --setenv="MODE=$mode" /bin/bash /automation/.github/scripts/ci/distribution/native-guest.sh "$1"
}
for mode in package quadlet; do
    guest install
    sudo cp "$rootfs/usr/bin/rentnerproxy" "$rootfs/root/quadlet-cli"
    boot=$(sudo cat "$rootfs/proc/sys/kernel/random/boot_id")
    sudo systemctl --machine "$machine" reboot
    for (( attempt=0; attempt<120; attempt++ )); do
        current=$(sudo cat "$rootfs/proc/sys/kernel/random/boot_id" 2>/dev/null || true)
        if [[ -n "$current" && "$current" != "$boot" ]]; then break; fi
        (( attempt < 119 )) || exit 1
        sleep 1
    done
    guest after-boot
done
printf '{"schemaVersion":1,"architecture":"%s","target":"%s","digest":"%s","revision":"%s","version":"%s","runId":"%s","runAttempt":%s,"passed":true}\n' "$ARCHITECTURE" "$TARGET" "$EXPECTED_DIGEST" "$REVISION" "$VERSION" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" > "$DISTRIBUTION_DIRECTORY/native-$TARGET-$ARCHITECTURE.json"

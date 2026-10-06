#!/usr/bin/env bash
set -Eeuo pipefail
# Foreign command failures cannot masquerade as a completed adverse assessment.
trap 'exit 1' ERR
: "${IMAGE_SOURCE:?}" "${REVISION:?}" "${REPORT_DIRECTORY:?}" "${AUTOMATION_DIRECTORY:?}"
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || exit 1
mkdir -p "$REPORT_DIRECTORY"
container=''
cleanup() {
    if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null || true; fi
    rm -f "$REPORT_DIRECTORY/runtime.tar" "$REPORT_DIRECTORY/caddy" "$REPORT_DIRECTORY/crowdsec" "$REPORT_DIRECTORY/cscli"
}
trap cleanup EXIT
rm -f "$REPORT_DIRECTORY/assessment.json" "$REPORT_DIRECTORY/blocked-assessment.json"
manifest="$REPORT_DIRECTORY/manifest.json"
skopeo inspect --raw "$IMAGE_SOURCE" > "$manifest"
digest="sha256:$(sha256sum "$manifest" | cut -d ' ' -f1)"
skopeo inspect --override-os linux --override-arch amd64 --config "$IMAGE_SOURCE" > "$REPORT_DIRECTORY/config.json"
jq --exit-status --arg revision "$REVISION" '.os == "linux" and .architecture == "amd64" and .config.Labels["org.opencontainers.image.revision"] == $revision' "$REPORT_DIRECTORY/config.json" > /dev/null
jq --null-input --arg revision "$REVISION" --arg digest "$digest" '{revision:$revision,digest:$digest}' > "$REPORT_DIRECTORY/identity.json"
policy="$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts"
profile="$REPORT_DIRECTORY/profile.json"
# Only the exact published source/index pair selects the historical runtime.
bun --no-env-file "$policy" profile "$REPORT_DIRECTORY/identity.json" "$profile"
cargo_lock_source_path="$(jq --exit-status --raw-output '.cargoLockSourcePath' "$profile")"
jq --exit-status --raw-output '.goBinaries[] | [.name, .path] | @tsv' "$profile" > "$REPORT_DIRECTORY/go-binaries.tsv"
community_module_query="$(jq --exit-status --raw-output '.communityModuleQuery | tostring' "$profile")"
export GRYPE_DB_CACHE_DIR="$RUNNER_TEMP/dependency-db"
export GRYPE_DB_VALIDATE_AGE=true GRYPE_DB_MAX_ALLOWED_BUILT_AGE=48h
export GRYPE_DB_REQUIRE_UPDATE_CHECK=true GRYPE_CHECK_FOR_APP_UPDATE=false
grype db update
grype db status --output json > "$REPORT_DIRECTORY/grype-db.json"
bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/security/dependency-policy.ts" database "$REPORT_DIRECTORY/grype-db.json"
# Grype's embedded Syft catalogs the full merged runtime (OS, npm and copied
# Go/native binaries); no runtime entrypoint or image command is executed.
scan_source="$IMAGE_SOURCE"
if [[ "$IMAGE_SOURCE" == docker://* ]]; then scan_source="registry:${IMAGE_SOURCE#docker://}"; fi
grype "$scan_source" --platform linux/amd64 --output json --file "$REPORT_DIRECTORY/image.json"
syft "$scan_source" --platform linux/amd64 --output "syft-json=$REPORT_DIRECTORY/inventory.json"
status=0
assess() {
    local result=0
    "$@" || result=$?
    if (( result != 0 && result != 3 )); then status=1
    elif (( result == 3 && status == 0 )); then status=3
    fi
}
assess bun --no-env-file "$policy" inventory "$REPORT_DIRECTORY/inventory.json" "$REPORT_DIRECTORY/identity.json"
assess bun --no-env-file "$policy" image "$REPORT_DIRECTORY/image.json"
# Convert as data; docker create is stopped and docker cp never starts services.
skopeo copy --override-os linux --override-arch amd64 "$IMAGE_SOURCE" "docker-archive:$REPORT_DIRECTORY/runtime.tar:local/rentnerproxy-security:scan"
docker load --input "$REPORT_DIRECTORY/runtime.tar"
container="$(docker create --entrypoint /bin/false local/rentnerproxy-security:scan)"
mkdir -p "$REPORT_DIRECTORY/locked-source/core" "$REPORT_DIRECTORY/locked-source/web"
if ! docker cp "$container:/usr/share/rentnerproxy/security/Cargo.lock" "$REPORT_DIRECTORY/locked-source/core/Cargo.lock"; then
    # Older supported releases predate the embedded lock. Fetch only lock data
    # from their validated exact source revision; never execute historical source.
    curl --fail --location --proto '=https' --tlsv1.2 \
        "https://raw.githubusercontent.com/$GITHUB_REPOSITORY/$REVISION/$cargo_lock_source_path" \
        --output "$REPORT_DIRECTORY/locked-source/core/Cargo.lock"
fi
locked_source_directory="$REPORT_DIRECTORY/locked-source"
controller_report_directory="$REPORT_DIRECTORY/controller"
SOURCE_DIRECTORY="$locked_source_directory" REPORT_DIRECTORY="$controller_report_directory" \
    assess bash "$AUTOMATION_DIRECTORY/.github/scripts/security/audit-cargo.sh"
docker cp "$container:/opt/rentnerproxy/web/bun.lock" "$REPORT_DIRECTORY/locked-source/web/bun.lock"
docker cp "$container:/opt/rentnerproxy/web/package.json" "$REPORT_DIRECTORY/locked-source/web/package.json"
(cd "$REPORT_DIRECTORY/locked-source/web" && bun --no-env-file audit --audit-level=moderate) > "$REPORT_DIRECTORY/bun-audit.txt" 2>&1 || status=1
while IFS=$'\t' read -r binary binary_path; do
    docker cp "$container:$binary_path" "$REPORT_DIRECTORY/$binary"
    go version -m -json "$REPORT_DIRECTORY/$binary" > "$REPORT_DIRECTORY/$binary-buildinfo.json"
    govulncheck -mode=binary -scan=symbol -json "$REPORT_DIRECTORY/$binary" | jq --slurp . > "$REPORT_DIRECTORY/$binary-govulncheck.json"
    assess bun --no-env-file "$policy" binary "$REPORT_DIRECTORY/$binary-govulncheck.json"
done < "$REPORT_DIRECTORY/go-binaries.tsv"
# The HTTP-only community module is a local replacement. govulncheck cannot
# resolve its local path: explicitly query its original embedded locked version.
if [[ "$community_module_query" == true ]]; then
    community_version="$(jq --raw-output '.Deps[] | select(.Path == "github.com/hslatman/caddy-crowdsec-bouncer") | .Version' "$REPORT_DIRECTORY/caddy-buildinfo.json")"
    [[ "$community_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] || { echo '::error::Community module version is unassessable'; exit 1; }
    govulncheck -mode=query -json "github.com/hslatman/caddy-crowdsec-bouncer@$community_version" | jq --slurp . > "$REPORT_DIRECTORY/community-govulncheck.json"
    assess bun --no-env-file "$policy" query "$REPORT_DIRECTORY/community-govulncheck.json"
fi
# Do not retain runnable binaries in advisory artifacts.
rm -f "$REPORT_DIRECTORY/caddy" "$REPORT_DIRECTORY/crowdsec" "$REPORT_DIRECTORY/cscli"
if (( status == 3 )); then
    bun --no-env-file "$policy" blocked "$REPORT_DIRECTORY/identity.json" "$REPORT_DIRECTORY/blocked-assessment.json"
fi
if (( status != 0 )); then exit "$status"; fi
bun --no-env-file "$policy" identity "$REPORT_DIRECTORY/identity.json" "$REPORT_DIRECTORY/assessment.json"
printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"

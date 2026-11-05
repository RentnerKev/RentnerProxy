#!/bin/bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && -f /rentnerproxy-isolated-distribution ]] || exit 1
[[ ${ARCHITECTURE:-} == amd64 || ${ARCHITECTURE:-} == arm64 ]] || exit 1
[[ ${TARGET:-} == debian || ${TARGET:-} == fedora ]] || exit 1
[[ ${MODE:-} == package || ${MODE:-} == quadlet ]] || exit 1
failed() {
    local result=$?
    printf 'Native %s %s %s failed at line %s (exit %s).\n' "$TARGET" "$ARCHITECTURE" "$MODE" "$1" "$result" >&2
    exit "$result"
}
trap 'failed "$LINENO"' ERR
# shellcheck source=/dev/null
source /etc/os-release
case "$TARGET/$ID/$VERSION_ID" in debian/debian/13|fedora/fedora/44) ;; *) exit 1 ;; esac
phase=${1:?}
base=http://192.0.2.1:18888
fingerprint=$(< /test/fixture-fingerprint)
[[ "$fingerprint" =~ ^[A-F0-9]{40}$ ]] || exit 1
wait_ready() {
    local attempt
    for (( attempt=0; attempt<180; attempt++ )); do
        if systemctl is-active --quiet rentnerproxy.service && podman healthcheck run rentnerproxy >/dev/null 2>&1; then return; fi
        sleep 2
    done
    printf '%s\n' 'Native service readiness failed.' >&2
    exit 1
}
repository() {
    local name=$1
    if [[ "$TARGET" == debian ]]; then
        install -m 0644 /test/repo-initial/keys/"$fingerprint.asc" /root/fixture-key.asc
        gpg --batch --yes --dearmor --output /usr/share/keyrings/rentnerproxy-fixture.gpg /root/fixture-key.asc
        chmod 0644 /usr/share/keyrings/rentnerproxy-fixture.gpg
        printf 'deb [signed-by=/usr/share/keyrings/rentnerproxy-fixture.gpg] %s/%s/apt beta main\n' "$base" "$name" > /etc/apt/sources.list.d/rentnerproxy.list
        apt-get update -o APT::Update::Error-Mode=any
    else
        install -m 0644 /test/repo-initial/keys/"$fingerprint.asc" /etc/pki/rpm-gpg/RENTNERPROXY-FIXTURE
        cat > /etc/yum.repos.d/rentnerproxy.repo <<REPO
[rentnerproxy]
name=RentnerProxy isolated CI fixture
baseurl=$base/$name/rpm/beta/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RENTNERPROXY-FIXTURE
REPO
        dnf --assumeyes --refresh makecache
    fi
}
probe() {
    printf 'Checking native %s %s %s: %s\n' "$TARGET" "$ARCHITECTURE" "$MODE" "$1"
    /root/bun --no-env-file /test/native-probe.js "$1"
}
consumer() {
    local work version
    local -a release
    work=$(mktemp -d /root/consumer-XXXXXXXX)
    mapfile -t release < <(/root/bun --no-env-file -e 'const r=await Bun.file("/usr/share/rentnerproxy/release.json").json();console.log([r.version,r.revision,r.digest].join("\n"))')
    [[ ${#release[@]} == 3 ]] || exit 1
    local -x RELEASE_VERSION=${release[0]} RELEASE_REVISION=${release[1]} RELEASE_DIGEST=${release[2]}
    cp /test/repo-initial/catalog.json "$work/catalog.json"
    version=$(/root/bun --no-env-file /automation/.github/scripts/distribution/consumer.ts version "$work")
    if [[ "$TARGET" == debian ]]; then
        (cd "$work"; apt-get download "rentnerproxy=$version")
    else
        dnf --assumeyes download --destdir "$work" "rentnerproxy-$version.$(rpm --eval '%{_arch}')"
    fi
    /root/bun --no-env-file /automation/.github/scripts/distribution/consumer.ts verify "$work"
    rm -rf -- "$work"
}
case "$phase" in
    install)
        install -d -m 0755 /etc/containers/registries.conf.d
        cat > /etc/containers/registries.conf.d/rentnerproxy-fixture.conf <<'MIRROR'
[[registry]]
prefix="ghcr.io/rentnerkev/rentnerproxy"
location="192.0.2.1:15000/rentnerkev/rentnerproxy"
insecure=true
MIRROR
        podman load --input /test/http3.tar >/dev/null
        if [[ "$MODE" == package ]]; then
            repository repo-initial
            if [[ "$TARGET" == debian ]]; then apt-get install --yes rentnerproxy; else dnf --assumeyes install rentnerproxy; fi
            if [[ "$TARGET" == fedora ]]; then
                case "$ARCHITECTURE" in amd64) rpm_architecture=x86_64 ;; arm64) rpm_architecture=aarch64 ;; esac
                cp -a /test/repo-initial/rpm/beta/"$rpm_architecture" /root/repository-probe
                probe_repository=(--assumeyes --disablerepo='*' '--repofrompath=rp-probe,file:///root/repository-probe' --enablerepo=rp-probe --setopt=rp-probe.gpgcheck=1 --setopt=rp-probe.repo_gpgcheck=1 --setopt=rp-probe.skip_if_unavailable=0 --setopt=rp-probe.gpgkey=file:///etc/pki/rpm-gpg/RENTNERPROXY-FIXTURE --refresh makecache)
                dnf "${probe_repository[@]}"
                printf corrupted > /root/repository-probe/repodata/repomd.xml.asc
                if dnf "${probe_repository[@]}"; then exit 1; fi
            fi
            metadata_hash=$(sha256sum /usr/share/rentnerproxy/release.json)
            install -d -m 0700 /root/package-overlay
            tar -xzf /test/packages/"$ARCHITECTURE"/*-quadlet.tar.gz -C /root/package-overlay
            if bash /root/package-overlay/install.sh; then exit 1; fi
            [[ $(sha256sum /usr/share/rentnerproxy/release.json) == "$metadata_hash" ]] || exit 1
            rm -rf -- /root/package-overlay
        else
            install -d -m 0700 /root/quadlet
            tar -xzf /test/packages/"$ARCHITECTURE"/*-quadlet.tar.gz -C /root/quadlet
            # A partial fresh install can be removed, but changed present files cannot.
            [[ ! -e /usr/bin/rentnerproxy ]] || exit 1
            install -m 0755 /root/quadlet/usr/bin/rentnerproxy /usr/bin/rentnerproxy
            printf '\n# changed fixture\n' >> /usr/bin/rentnerproxy
            if bash /root/quadlet/uninstall.sh; then exit 1; fi
            [[ -f /usr/bin/rentnerproxy ]] || exit 1
            install -m 0755 /root/quadlet/usr/bin/rentnerproxy /usr/bin/rentnerproxy
            bash /root/quadlet/uninstall.sh
            [[ ! -e /usr/bin/rentnerproxy ]] || exit 1
            bash /root/quadlet/install.sh
        fi
        if systemctl is-active --quiet rentnerproxy.service; then exit 1; fi
        cat > /etc/rentnerproxy/appliance.env <<'CONFIGURATION'
PUBLIC_ORIGIN=https://management.distribution.invalid
PROXY_TRUSTED_PROXY_CIDRS=
SMTP_FROM=Distribution fixture <fixture@distribution.invalid>
SMTP_HOST=smtp.distribution.invalid
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=fixture
SMTP_PASSWORD=isolated-synthetic-fixture
CONFIGURATION
        chmod 0600 /etc/rentnerproxy/appliance.env
        rentnerproxy start
        install -d -m 0700 '/root/colon:backup'
        if rentnerproxy backup '/root/colon:backup'; then exit 1; fi
        if rentnerproxy restore '/root/colon:backup' --confirm-replace; then exit 1; fi
        systemctl is-active --quiet rentnerproxy.service
        rmdir -- '/root/colon:backup'
        podman cp rentnerproxy:/usr/local/bin/bun /root/bun
        chmod 0700 /root/bun
        if [[ "$MODE" == package ]]; then consumer; fi
        probe seed
        install -d -m 0700 /root/backups
        rentnerproxy backup /root/backups
        probe verify
        backup=$(find /root/backups -mindepth 1 -maxdepth 1 -type d -name 'rentnerproxy-*' -print)
        [[ -n "$backup" && "$backup" != *$'\n'* ]] || exit 1
        cp -a -- "$backup" /root/bad-backup
        printf broken > /root/bad-backup/postgres.dump
        if rentnerproxy restore /root/bad-backup --confirm-replace; then exit 1; fi
        if systemctl is-active --quiet rentnerproxy.service; then exit 1; fi
        rentnerproxy start
        # A generated-column function executes during pg_restore. Its canary
        # write must be unable to reach the appliance when validation rejects it.
        probe malicious
        install -d -m 0700 /root/evil-backups
        rentnerproxy backup /root/evil-backups
        evil_backup=$(find /root/evil-backups -mindepth 1 -maxdepth 1 -type d -name 'rentnerproxy-*' -print)
        [[ -n "$evil_backup" && "$evil_backup" != *$'\n'* ]] || exit 1
        if rentnerproxy restore "$evil_backup" --confirm-replace; then exit 1; fi
        if systemctl is-active --quiet rentnerproxy.service; then exit 1; fi
        mountpoint=$(podman volume inspect --format '{{.Mountpoint}}' rentnerproxy-data)
        [[ $(< "$mountpoint/postgres-data/validation-canary") == original ]] || exit 1
        # Positive control on this explicitly isolated fixture: the same SQL
        # does overwrite the canary if the forbidden data-volume mount is added.
        install -d -m 0700 /root/validation-control
        image=$(< /usr/share/rentnerproxy/image)
        if podman run --rm --image-volume=ignore --network none --volume "$evil_backup:/backup:ro,Z" --volume /root/validation-control:/tmp/rentnerproxy-validated:Z --volume rentnerproxy-data:/var/lib/rentnerproxy:Z --entrypoint bun "$image" --no-env-file /opt/rentnerproxy/web/backup-maintenance.js validate; then exit 1; fi
        [[ $(< "$mountpoint/postgres-data/validation-canary") == overwritten ]] || exit 1
        rentnerproxy start
        probe mutate
        rentnerproxy restore "$backup" --confirm-replace
        probe verify
        configuration_hash=$(sha256sum /etc/rentnerproxy/appliance.env)
        if [[ "$MODE" == package ]]; then
            repository repo-upgrade
            if [[ "$TARGET" == debian ]]; then apt-get install --yes --only-upgrade rentnerproxy; else dnf --assumeyes upgrade rentnerproxy; fi
        else
            tar -xzf /test/upgrade/"$ARCHITECTURE"/*-quadlet.tar.gz -C /root/quadlet
            bash /root/quadlet/install.sh
        fi
        [[ $(sha256sum /etc/rentnerproxy/appliance.env) == "$configuration_hash" ]] || exit 1
        [[ -s /var/lib/rentnerproxy-distribution/previous.image ]] || exit 1
        wait_ready
        probe verify
        invocation=$(systemctl show --property InvocationID --value rentnerproxy.service)
        [[ "$invocation" =~ ^[a-f0-9]{32}$ ]] || exit 1
        rentnerproxy stop
        shutdown_log=$(journalctl --no-pager --output cat "_SYSTEMD_INVOCATION_ID=$invocation")
        [[ "$shutdown_log" == *'shutdown signal received'* && "$shutdown_log" == *'database system is shut down'* ]] || exit 1
        [[ -z $(podman ps --filter name=rentnerproxy --format '{{.Names}}') ]] || exit 1
        rentnerproxy start
        podman kill --signal KILL rentnerproxy
        wait_ready
        probe verify
        ;;
    after-boot)
        wait_ready
        probe verify
        # Rollback the package and restore the compatible external v4 snapshot.
        rentnerproxy stop
        if [[ "$MODE" == package ]]; then
            repository repo-initial
            if [[ "$TARGET" == debian ]]; then
                previous_version=$(dpkg-deb --field /test/packages/"$ARCHITECTURE"/*.deb Version)
                apt-get install --yes --allow-downgrades "rentnerproxy=$previous_version"
            else
                dnf --assumeyes downgrade rentnerproxy
            fi
        else
            tar -xzf /test/packages/"$ARCHITECTURE"/*-quadlet.tar.gz -C /root/quadlet
            bash /root/quadlet/install.sh
        fi
        backup=$(find /root/backups -mindepth 1 -maxdepth 1 -type d -name 'rentnerproxy-*' -print)
        rentnerproxy restore "$backup" --confirm-replace
        probe verify
        rentnerproxy stop
        volume_hash=$(podman volume inspect --format '{{.Mountpoint}}' rentnerproxy-data)
        [[ -f "$volume_hash/bootstrap/secrets-v1.json" ]] || exit 1
        rentnerproxy purge-data --confirm-purge
        if podman volume exists rentnerproxy-data; then exit 1; fi
        rentnerproxy restore "$backup" --confirm-replace
        probe verify
        rentnerproxy stop
        volume_hash=$(podman volume inspect --format '{{.Mountpoint}}' rentnerproxy-data)
        [[ -f "$volume_hash/bootstrap/secrets-v1.json" ]] || exit 1
        if [[ "$MODE" == package ]]; then
            if [[ "$TARGET" == debian ]]; then apt-get purge --yes rentnerproxy; else dnf --assumeyes remove rentnerproxy; fi
        else
            bash /root/quadlet/uninstall.sh
        fi
        [[ -f /etc/rentnerproxy/appliance.env && -f "$volume_hash/bootstrap/secrets-v1.json" ]] || exit 1
        # Only this explicitly marked disposable appliance is purged for the next fresh install.
        /root/quadlet-cli purge-data --confirm-purge
        rm -- /etc/rentnerproxy/appliance.env
        rm -rf -- /root/quadlet /root/backups /root/bad-backup /root/evil-backups /root/validation-control
        ;;
    *) exit 1 ;;
esac

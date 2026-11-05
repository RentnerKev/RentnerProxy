#!/bin/bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && -f /rentnerproxy-isolated-distribution ]] || exit 1
[[ ${ARCHITECTURE:-} == amd64 || ${ARCHITECTURE:-} == arm64 ]] || exit 1
[[ ${TARGET:-} == debian || ${TARGET:-} == fedora ]] || exit 1
[[ ${MODE:-} == package || ${MODE:-} == quadlet ]] || exit 1
trap 'result=$?; printf "Native %s %s %s failed at line %s (exit %s).\n" "$TARGET" "$ARCHITECTURE" "$MODE" "$LINENO" "$result" >&2; exit "$result"' ERR
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
        else
            install -d -m 0700 /root/quadlet
            tar -xzf /test/packages/"$ARCHITECTURE"/*-quadlet.tar.gz -C /root/quadlet
            bash /root/quadlet/install.sh
        fi
        if systemctl is-active --quiet rentnerproxy.service; then exit 1; fi
        # Reused assessed OCI fixtures predate the explicit OCI-compatible
        # health configuration. Exercise the proposed Quadlet settings as a
        # temporary drop-in; the real PR gate rebuilds its exact packages.
        install -d /etc/containers/systemd/rentnerproxy.container.d
        cat > /etc/containers/systemd/rentnerproxy.container.d/health.conf <<'HEALTH'
[Container]
HealthCmd=bun /opt/rentnerproxy/web/docker/web/healthcheck.ts
HealthInterval=10s
HealthTimeout=5s
HealthStartPeriod=60s
HealthRetries=12
HEALTH
        systemctl daemon-reload
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
        podman cp rentnerproxy:/usr/local/bin/bun /root/bun
        chmod 0700 /root/bun
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
        if [[ "$MODE" == package ]]; then
            if [[ "$TARGET" == debian ]]; then apt-get purge --yes rentnerproxy; else dnf --assumeyes remove rentnerproxy; fi
        else
            bash /root/quadlet/uninstall.sh
        fi
        [[ -f /etc/rentnerproxy/appliance.env && -f "$volume_hash/bootstrap/secrets-v1.json" ]] || exit 1
        # Only this explicitly marked disposable appliance is purged for the next fresh install.
        /root/quadlet-cli purge-data --confirm-purge
        rm -- /etc/rentnerproxy/appliance.env
        rm -rf -- /root/quadlet /root/backups /root/bad-backup
        ;;
    *) exit 1 ;;
esac

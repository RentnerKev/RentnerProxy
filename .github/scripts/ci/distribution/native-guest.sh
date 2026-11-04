#!/bin/bash
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 && -f /rentnerproxy-isolated-distribution ]] || exit 1
[[ ${ARCHITECTURE:-} == amd64 || ${ARCHITECTURE:-} == arm64 ]] || exit 1
[[ ${TARGET:-} == debian || ${TARGET:-} == fedora ]] || exit 1
[[ ${MODE:-} == package || ${MODE:-} == quadlet ]] || exit 1
phase=${1:?}
base=http://127.0.0.1:18888
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
baseurl=$base/$name/rpm/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RENTNERPROXY-FIXTURE
REPO
        dnf --assumeyes --refresh makecache
    fi
}
probe() { /root/bun --no-env-file /test/native-probe.js "$1"; }
case "$phase" in
    install)
        install -d -m 0755 /etc/containers/registries.conf.d
        cat > /etc/containers/registries.conf.d/rentnerproxy-fixture.conf <<'MIRROR'
[[registry]]
prefix="ghcr.io/rentnerkev/rentnerproxy"
location="127.0.0.1:15000/rentnerkev/rentnerproxy"
insecure=true
MIRROR
        podman load --input /test/http3.tar >/dev/null
        if [[ "$MODE" == package ]]; then
            repository repo-initial
            if [[ "$TARGET" == debian ]]; then apt-get install --yes rentnerproxy; else dnf --assumeyes install rentnerproxy; fi
        else
            install -d -m 0700 /root/quadlet
            tar -xzf /test/packages/"$ARCHITECTURE"/*-quadlet.tar.gz -C /root/quadlet
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
        podman cp rentnerproxy:/usr/local/bin/bun /root/bun
        chmod 0700 /root/bun
        probe seed
        install -d -m 0700 /root/backups
        rentnerproxy backup /root/backups
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
        rentnerproxy stop
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
            if [[ "$TARGET" == debian ]]; then
                apt-get install --yes --allow-downgrades /test/packages/"$ARCHITECTURE"/*.deb
            else
                rpm --import /test/repo-initial/keys/"$fingerprint.asc"
                dnf --assumeyes downgrade /test/repo-initial/releases/*/1/"$ARCHITECTURE"/*.rpm
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
            while IFS= read -r path; do rm -- "/$path"; done < <(tar -tzf /test/packages/"$ARCHITECTURE"/*-quadlet.tar.gz | sed -n 's|^\./\(usr/.*[^/]\)$|\1|p')
            systemctl daemon-reload
        fi
        [[ -f /etc/rentnerproxy/appliance.env && -f "$volume_hash/bootstrap/secrets-v1.json" ]] || exit 1
        # Only this explicitly marked disposable appliance is purged for the next fresh install.
        /root/quadlet-cli purge-data --confirm-purge
        rm -- /etc/rentnerproxy/appliance.env
        rm -rf -- /root/quadlet /root/backups /root/bad-backup
        ;;
    *) exit 1 ;;
esac

# syntax=docker/dockerfile:1

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS web-dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM web-dependencies AS web-build

COPY . .
ARG RENTNERPROXY_BUILD_VERSION
RUN RENTNERPROXY_BUILD_VERSION="$RENTNERPROXY_BUILD_VERSION" bun run build:web \
    && bun build web/src/db/migrate.ts --target=bun --outfile=/build/migrate.js \
    && bun docker/web/package-migrations.ts ./web/drizzle /build/migrations

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS web-runtime

WORKDIR /app
COPY package.json bun.lock ./
COPY docker/web/prune-build-tools.sh /tmp/prune-build-tools.sh
RUN bun install --frozen-lockfile --production \
    && /bin/sh /tmp/prune-build-tools.sh \
    && rm /tmp/prune-build-tools.sh
COPY --from=web-build /app/web/dist ./web/dist
COPY --from=web-build /build/migrations ./web/drizzle
COPY --from=web-build /build/migrate.js ./migrate.js
COPY --from=web-build /app/docker/web/bootstrap-secrets.mjs ./docker/web/bootstrap-secrets.mjs
COPY --from=web-build /app/docker/web/validate-backup.mjs ./docker/web/validate-backup.mjs
COPY --from=web-build /app/docker/web/request-context.ts ./docker/web/request-context.ts
COPY --from=web-build /app/docker/web/static-assets.ts ./docker/web/static-assets.ts
COPY --from=web-build /app/docker/web/serve.mjs ./docker/web/serve.mjs
COPY --from=web-build /app/docker/web/healthcheck.mjs ./docker/web/healthcheck.mjs

FROM rust:1.99.0-bookworm@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS controller-build

WORKDIR /build
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
RUN cargo build --locked --release

# The builder supplies CADDY_VERSION so image updates also update the compiled binary.
# The module revision is the signed v0.14.1 release.
# Upstream's HTTP package imports AppSec and a shared Layer 4 helper. Remove those
# registrations so the appliance exposes only the required HTTP bouncer.
FROM caddy:2.11.7-builder@sha256:1ab914bd604996ab195f6326665cd2ae5d3df62feba973e776c4c8d5967d57a5 AS caddy-build

ARG CADDY_CROWDSEC_BOUNCER_COMMIT=6b35f6be25e457aa0b94e32c6ae519123e50e7b7
ARG CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256=5ff0fd225d1d14cb29633516f0dfe084835dc99dc065ae11db852c661e9ced0d
COPY docker/crowdsec/tooling/caddy-http-only.sh /tmp/caddy-crowdsec-http-only.sh
WORKDIR /tmp/caddy-crowdsec-bouncer
RUN wget -qO /tmp/caddy-crowdsec-bouncer.tar.gz \
        "https://codeload.github.com/hslatman/caddy-crowdsec-bouncer/tar.gz/${CADDY_CROWDSEC_BOUNCER_COMMIT}" \
    && echo "${CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256}  /tmp/caddy-crowdsec-bouncer.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/caddy-crowdsec-bouncer.tar.gz --strip-components=1 \
    && /bin/sh /tmp/caddy-crowdsec-http-only.sh /tmp/caddy-crowdsec-bouncer \
    && xcaddy build "${CADDY_VERSION:?Caddy builder must specify CADDY_VERSION}" --output /usr/bin/caddy \
        --with github.com/hslatman/caddy-crowdsec-bouncer/http@${CADDY_CROWDSEC_BOUNCER_COMMIT} \
        --replace github.com/hslatman/caddy-crowdsec-bouncer=/tmp/caddy-crowdsec-bouncer \
        --replace github.com/crowdsecurity/crowdsec=github.com/crowdsecurity/crowdsec@v1.7.8 \
    && go version -m /usr/bin/caddy | grep -Eq '=>[[:space:]]+github\.com/crowdsecurity/crowdsec[[:space:]]+v1\.7\.8[[:space:]]' \
    && caddy_version="$(/usr/bin/caddy version)" \
    && printf '%s\n' "$caddy_version" \
    && test "${caddy_version%% *}" = "$CADDY_VERSION" \
    && /usr/bin/caddy list-modules | grep -Fx crowdsec \
    && /usr/bin/caddy list-modules | grep -Fx http.handlers.crowdsec \
    && ! /usr/bin/caddy list-modules | grep -Eq '(^|\.)layer4($|\.)|^http\.handlers\.appsec$'

FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS geoip-assets
COPY scripts/assets/download-geoip.ts /tmp/download-geoip.ts
RUN bun --no-env-file /tmp/download-geoip.ts

# Retain upstream CrowdSec 1.8.1 and its full static build profile, while fixing
# the gRPC/SSH dependencies that are still embedded in its official image.
FROM golang:1.27.1-trixie@sha256:8f58fd67ea075142d947a60e0caa4317746a55118d312f027793d382c7741734 AS crowdsec-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pkg-config ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY docker/crowdsec/tooling/engine-build/ /opt/crowdsec-build/
RUN /bin/sh /opt/crowdsec-build/build.sh /out

FROM ghcr.io/crowdsecurity/crowdsec:v1.8.1-debian@sha256:ab1bdb61a072154d478ad6c625b8e62c7f79a727b2740209d2128dd51d69d58d AS crowdsec-assets

COPY docker/crowdsec/hub/data.sha256 /tmp/rentnerproxy-crowdsec-hub-data.sha256
RUN set -eux; \
    mkdir -p /etc/crowdsec /var/lib/crowdsec /opt/rentnerproxy/crowdsec-config; \
    cp -a /staging/etc/crowdsec/. /etc/crowdsec/; \
    cp -a /staging/var/lib/crowdsec/. /var/lib/crowdsec/; \
    sed -i '/^cscli:/a\  hub_branch: 435f7d81caf247241bd6068f0a778bafa8dfe975' /etc/crowdsec/config.yaml; \
    cscli -c /etc/crowdsec/config.yaml collections remove crowdsecurity/linux --force >/dev/null; \
    rm -rf /var/lib/crowdsec/data/*; \
    cscli -c /etc/crowdsec/config.yaml parsers install \
        crowdsecurity/syslog-logs crowdsecurity/whitelists --error >/dev/null; \
    cscli -c /etc/crowdsec/config.yaml collections install crowdsecurity/caddy --error >/dev/null; \
    cd /var/lib/crowdsec/data; \
    sha256sum --check /tmp/rentnerproxy-crowdsec-hub-data.sha256; \
    rm -f /etc/crowdsec/local_api_credentials.yaml \
        /etc/crowdsec/online_api_credentials.yaml; \
    cp -aL /etc/crowdsec/. /opt/rentnerproxy/crowdsec-config/

FROM valkey/valkey:9.1.2-trixie@sha256:418652cfb58ef879d4978c33553735d7147016032d5aefaa14c828e611eb9dfd AS valkey-runtime

FROM postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336 AS runtime

LABEL org.opencontainers.image.source="https://github.com/RentnerKev/RentnerProxy" \
    org.opencontainers.image.description="Modern self-hosted reverse proxy manager powered by Caddy."

ENV APP_DIR=/opt/rentnerproxy/web \
    NODE_ENV=production \
    PGDATA=/var/lib/rentnerproxy/postgres-data \
    RENTNERPROXY_CADDY_BIN=/usr/bin/caddy \
    RENTNERPROXY_PROXY_HTTP_PORT=8080 \
    RENTNERPROXY_PROXY_HTTPS_PORT=8443 \
    RENTNERPROXY_PROXY_STATE_DIR=/var/lib/rentnerproxy/proxy \
    RENTNERPROXY_SYSTEM_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade libpcre2-8-0 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libpcre2-8-0)" ge '10.46-1~deb13u3' \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl tini libcap2-bin libsystemd0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 rentnerproxy \
    && useradd --uid 10001 --gid rentnerproxy --no-create-home --shell /usr/sbin/nologin rentnerproxy \
    && groupadd --gid 10002 rentnerproxy-web \
    && useradd --uid 10002 --gid rentnerproxy-web --no-create-home --shell /usr/sbin/nologin rentnerproxy-web \
    && groupadd --gid 10003 crowdsec \
    && useradd --uid 10003 --gid crowdsec --no-create-home --shell /usr/sbin/nologin crowdsec \
    && install -d -m 0711 -o root -g root /var/lib/rentnerproxy \
    && install -d -m 0700 -o postgres -g postgres /var/lib/rentnerproxy/postgres-data \
    && install -d -m 0710 -o rentnerproxy -g crowdsec /var/lib/rentnerproxy/proxy \
    && install -d -m 2750 -o rentnerproxy -g crowdsec /var/lib/rentnerproxy/proxy/logs \
    && install -d -m 0711 -o crowdsec -g crowdsec /var/lib/rentnerproxy/crowdsec \
    && install -d -m 0700 -o crowdsec -g crowdsec /var/lib/rentnerproxy/crowdsec/credentials \
    && install -d -m 0700 -o crowdsec -g crowdsec /var/lib/rentnerproxy/crowdsec/data \
    && install -d -m 0710 -o root -g rentnerproxy /var/lib/rentnerproxy/crowdsec/bouncer \
    && install -d -m 0700 -o root -g root /var/lib/rentnerproxy/bootstrap \
    && install -d -m 0700 -o postgres -g postgres /var/run/postgresql \
    && chmod 00700 /var/run/postgresql \
    && install -d -m 0755 /opt/rentnerproxy/valkey/bin

COPY --from=web-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=web-runtime /app /opt/rentnerproxy/web
COPY --from=controller-build /build/target/release/rentnerproxy-controller /usr/local/bin/rentnerproxy-controller
# Retain the exact locked controller graph for recurring RustSec assessments.
COPY core/Cargo.lock /usr/share/rentnerproxy/security/Cargo.lock
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY --from=crowdsec-build /out/bin/crowdsec /usr/local/bin/crowdsec
COPY --from=crowdsec-build /out/bin/cscli /usr/local/bin/cscli
COPY --from=crowdsec-assets /opt/rentnerproxy/crowdsec-config /usr/share/rentnerproxy/crowdsec/config
COPY --from=crowdsec-assets /var/lib/crowdsec/data /usr/share/rentnerproxy/crowdsec/data
COPY --from=geoip-assets /tmp/user-country.mmdb /usr/share/rentnerproxy/geoip/user-country.mmdb
COPY docker/crowdsec/runtime/config.yaml /usr/share/rentnerproxy/crowdsec/config.yaml
COPY docker/crowdsec/runtime/config-online.yaml /usr/share/rentnerproxy/crowdsec/config-online.yaml
COPY docker/crowdsec/runtime/acquis.yaml /usr/share/rentnerproxy/crowdsec/acquis.yaml
COPY docker/licenses/Caddy-LICENSE /usr/share/licenses/caddy/LICENSE
COPY docker/licenses/Caddy-LICENSE /usr/share/licenses/caddy-crowdsec-bouncer/LICENSE
COPY docker/licenses/CaddyCrowdSecBouncer-NOTICE /usr/share/licenses/caddy-crowdsec-bouncer/NOTICE
COPY docker/licenses/CrowdSec-LICENSE /usr/share/licenses/crowdsec/LICENSE
COPY docker/licenses/CrowdSec-NOTICE /usr/share/licenses/crowdsec/NOTICE
COPY docker/licenses/GeoIP-NOTICE /usr/share/licenses/rentnerproxy-geoip/NOTICE
COPY docker/licenses/Valkey-LICENSE /usr/share/licenses/valkey/LICENSE
COPY docker/licenses/Valkey-NOTICE /usr/share/licenses/valkey/NOTICE
COPY --from=valkey-runtime /usr/local/bin/valkey-server /usr/local/bin/valkey-cli /opt/rentnerproxy/valkey/bin/
COPY docker/production/entrypoint.sh /usr/local/bin/rentnerproxy-production
COPY docker/crowdsec/runtime/supervisor.sh /usr/local/bin/rentnerproxy-crowdsec-supervisor

RUN chmod 0555 /usr/local/bin/rentnerproxy-production \
    && chmod 0555 /usr/local/bin/rentnerproxy-crowdsec-supervisor \
    && chmod 0555 /usr/local/bin/rentnerproxy-controller \
    && chmod 0555 /usr/local/bin/crowdsec /usr/local/bin/cscli \
    && chmod 0555 /usr/local/bin/bun \
    && chmod 0555 /opt/rentnerproxy/valkey/bin/valkey-server /opt/rentnerproxy/valkey/bin/valkey-cli \
    && /opt/rentnerproxy/valkey/bin/valkey-server --version | grep -F 'v=9.1.2 ' \
    && /opt/rentnerproxy/valkey/bin/valkey-cli --version | grep -Fx 'valkey-cli 9.1.2' \
    && ldd /opt/rentnerproxy/valkey/bin/valkey-server > /tmp/valkey-server-libraries \
    && ldd /opt/rentnerproxy/valkey/bin/valkey-cli > /tmp/valkey-cli-libraries \
    && ! grep -F 'not found' /tmp/valkey-server-libraries /tmp/valkey-cli-libraries \
    && rm /tmp/valkey-server-libraries /tmp/valkey-cli-libraries \
    && install -d -m 0555 -o root -g root /usr/share/rentnerproxy/crowdsec/plugins \
    && find /usr/share/rentnerproxy/crowdsec -type d -exec chmod 0555 {} + \
    && find /usr/share/rentnerproxy/crowdsec -type f -exec chmod 0444 {} + \
    && ! find /usr/share/rentnerproxy/crowdsec -type l -print -quit | grep -q . \
    && gosu crowdsec cscli -c /usr/share/rentnerproxy/crowdsec/config.yaml collections list -o json | grep -F 'crowdsecurity/caddy' \
    && /usr/bin/caddy list-modules | grep -Fx crowdsec \
    && /usr/bin/caddy list-modules | grep -Fx http.handlers.crowdsec \
    && ! /usr/bin/caddy list-modules | grep -Eq '(^|\.)layer4($|\.)|^http\.handlers\.appsec$' \
    && /usr/local/bin/crowdsec -version | grep -F 'version: v1.8.1-909b5157986a2b2c2163300fdaef5ed01289f7d2' \
    && setcap -r /usr/bin/caddy \
    && apt-get purge -y --auto-remove libcap2-bin \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 3000 8080 8443/tcp 8443/udp
VOLUME ["/var/lib/rentnerproxy"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=12 CMD ["bun", "/opt/rentnerproxy/web/docker/web/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/rentnerproxy-production"]

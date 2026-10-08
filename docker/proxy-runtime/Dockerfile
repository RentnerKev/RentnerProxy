FROM rust:1.99.0-bookworm@sha256:114c7a4425406451c2866b6aafe69fe29b1b298832db1277d411ac73c82d04d6 AS builder

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

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587

COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY docker/licenses/Caddy-LICENSE /usr/share/licenses/caddy/LICENSE
COPY docker/licenses/Caddy-LICENSE /usr/share/licenses/caddy-crowdsec-bouncer/LICENSE
COPY docker/licenses/CaddyCrowdSecBouncer-NOTICE /usr/share/licenses/caddy-crowdsec-bouncer/NOTICE

COPY --from=builder /build/target/release/rentnerproxy-controller /usr/local/bin/rentnerproxy-controller
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl procps libcap2-bin \
    && update-ca-certificates \
    && /usr/bin/caddy list-modules | grep -Fx crowdsec \
    && /usr/bin/caddy list-modules | grep -Fx http.handlers.crowdsec \
    && ! /usr/bin/caddy list-modules | grep -Eq '(^|\.)layer4($|\.)|^http\.handlers\.appsec$' \
    && setcap -r /usr/bin/caddy \
    && apt-get purge -y --auto-remove libcap2-bin \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/rentnerproxy/proxy \
    && chown 10001:10001 /var/lib/rentnerproxy/proxy
USER 10001:10001

ENV RENTNERPROXY_CONTROLLER_LISTEN_ADDR=0.0.0.0:8081 \
    RENTNERPROXY_CADDY_BIN=/usr/bin/caddy \
    RENTNERPROXY_PROXY_STATE_DIR=/var/lib/rentnerproxy/proxy \
    RENTNERPROXY_PROXY_HTTP_PORT=8080 \
    RENTNERPROXY_PROXY_HTTPS_PORT=8443 \
    RENTNERPROXY_SYSTEM_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 8080 8081 8443/tcp 8443/udp
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/rentnerproxy-controller"]

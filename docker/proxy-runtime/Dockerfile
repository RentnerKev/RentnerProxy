FROM mirror.gcr.io/library/rust:1.99.0-trixie@sha256:6ff07edce8775d0f64be7aba9197229407301bddf2054d62c27b541a6238a181 AS builder

WORKDIR /build
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
RUN cargo build --locked --release

FROM mirror.gcr.io/library/golang:1.27.2-alpine@sha256:85dc1069ac644ea3c527b177303a406eb3358192816cd7f9e5848eb658851673 AS caddy-go-toolchain

# The builder supplies CADDY_VERSION so image updates also update the compiled binary.
# The module revision is the signed v0.14.1 release.
# Upstream's HTTP package imports AppSec and a shared Layer 4 helper. Remove those
# registrations so the appliance exposes only the required HTTP bouncer.
FROM mirror.gcr.io/library/caddy:2.11.7-builder@sha256:b25f47453fa02f7e66c0828b4b1343658808b9000950b6825c4a1cb0c988f5f8 AS caddy-build

RUN rm -rf /usr/local/go
COPY --from=caddy-go-toolchain /usr/local/go/ /usr/local/go/
ENV GOTOOLCHAIN=local CGO_ENABLED=0

ARG CADDY_CROWDSEC_BOUNCER_COMMIT=6b35f6be25e457aa0b94e32c6ae519123e50e7b7
ARG CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256=5ff0fd225d1d14cb29633516f0dfe084835dc99dc065ae11db852c661e9ced0d
COPY docker/crowdsec/tooling/caddy-http-only.sh /tmp/caddy-crowdsec-http-only.sh
COPY docker/caddy/tooling/verify-buildinfo.sh /tmp/verify-caddy-buildinfo.sh
WORKDIR /tmp/caddy-crowdsec-bouncer
RUN test "$(go env GOVERSION)" = go1.27.2 \
    && wget -qO /tmp/caddy-crowdsec-bouncer.tar.gz \
        "https://codeload.github.com/hslatman/caddy-crowdsec-bouncer/tar.gz/${CADDY_CROWDSEC_BOUNCER_COMMIT}" \
    && echo "${CADDY_CROWDSEC_BOUNCER_SOURCE_SHA256}  /tmp/caddy-crowdsec-bouncer.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/caddy-crowdsec-bouncer.tar.gz --strip-components=1 \
    && /bin/sh /tmp/caddy-crowdsec-http-only.sh /tmp/caddy-crowdsec-bouncer \
    && xcaddy build "${CADDY_VERSION:?Caddy builder must specify CADDY_VERSION}" --output /usr/bin/caddy \
        --with github.com/hslatman/caddy-crowdsec-bouncer/http@${CADDY_CROWDSEC_BOUNCER_COMMIT} \
        --replace github.com/hslatman/caddy-crowdsec-bouncer=/tmp/caddy-crowdsec-bouncer \
        --replace github.com/crowdsecurity/crowdsec=github.com/crowdsecurity/crowdsec@v1.8.1 \
        --replace golang.org/x/net=golang.org/x/net@v0.61.0 \
        --replace golang.org/x/crypto=golang.org/x/crypto@v0.58.0 \
        --replace golang.org/x/sys=golang.org/x/sys@v0.49.0 \
        --replace golang.org/x/term=golang.org/x/term@v0.47.0 \
        --replace golang.org/x/text=golang.org/x/text@v0.43.0 \
    && go version -m /usr/bin/caddy > /tmp/caddy-buildinfo.txt \
    && /bin/sh /tmp/verify-caddy-buildinfo.sh /tmp/caddy-buildinfo.txt \
    && go version -m /usr/bin/caddy | grep -Eq '=>[[:space:]]+github\.com/crowdsecurity/crowdsec[[:space:]]+v1\.8\.1[[:space:]]' \
    && caddy_version="$(/usr/bin/caddy version)" \
    && printf '%s\n' "$caddy_version" \
    && test "${caddy_version%% *}" = "$CADDY_VERSION" \
    && /usr/bin/caddy list-modules | grep -Fx crowdsec \
    && /usr/bin/caddy list-modules | grep -Fx http.handlers.crowdsec \
    && ! /usr/bin/caddy list-modules | grep -Eq '(^|\.)layer4($|\.)|^http\.handlers\.appsec$'

FROM mirror.gcr.io/library/debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

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

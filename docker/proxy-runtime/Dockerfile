FROM mirror.gcr.io/library/rust:1.99.1-trixie@sha256:8a4e90c7946b74626488b1446f712c0fe0ed1a596cbd3d871684bc9c5433ae07 AS builder

WORKDIR /build
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
ARG RENTNERPROXY_BUILD_VERSION
RUN RENTNERPROXY_BUILD_VERSION="$RENTNERPROXY_BUILD_VERSION" cargo build --locked --release

FROM mirror.gcr.io/library/golang:1.27.3-alpine@sha256:fa3d596898d9f126af7c01d14ee7597bab3f39cccf392ef36b69fe77cd681f18 AS caddy-go-toolchain

# The builder supplies CADDY_VERSION so image updates also update the compiled binary.
# Apply the reviewed reload-lifecycle backport to a verified upstream copy.
# Their optional AppSec and Layer 4 modules remain unconfigured.
FROM mirror.gcr.io/library/caddy:2.11.7-builder@sha256:c4cd20eaa0b69112fd5d4f721ffc9671687e1d5d0b155c8620cf7546dbef94c0 AS caddy-build

RUN rm -rf /usr/local/go
COPY --from=caddy-go-toolchain /usr/local/go/ /usr/local/go/
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org

ARG CADDY_CROWDSEC_BOUNCER_VERSION=v0.14.2-0.20261030164527-4a6ce1d3094d
ARG CADDY_LAYER4_VERSION=v0.1.3-0.20261029145729-f607ccea1b7d
COPY docker/tooling/buildinfo/verify.go /tmp/verify-buildinfo.go
COPY docker/caddy/tooling/build.sh /tmp/build-caddy.sh
COPY docker/caddy/tooling/prepare-source.sh /tmp/prepare-caddy-source.sh
COPY docker/caddy/patches/ /opt/rentnerproxy-caddy-patches/
COPY core/caddy-modules/responsecache/ /opt/rentnerproxy-responsecache/
WORKDIR /tmp/rentnerproxy-caddy
RUN /bin/sh /tmp/build-caddy.sh

FROM caddy-build AS caddy-reload-tests
RUN apk add --no-cache build-base
ENV CGO_ENABLED=1
WORKDIR /opt/rentnerproxy-responsecache
RUN go test -mod=readonly -race -short -timeout=120s -p=1 \
    github.com/caddyserver/caddy/v2 \
    github.com/caddyserver/caddy/v2/modules/caddyhttp \
    github.com/caddyserver/caddy/v2/modules/caddyhttp/reverseproxy \
    github.com/caddyserver/caddy/v2/modules/caddytls

FROM mirror.gcr.io/library/debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

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
    && /usr/bin/caddy list-modules | grep -Fx http.handlers.rentnerproxy_response_cache \
    && /usr/bin/caddy list-modules | grep -Fx http.handlers.rentnerproxy_upstream \
    && /usr/bin/caddy list-modules | grep -Fx admin.api.rentnerproxy \
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

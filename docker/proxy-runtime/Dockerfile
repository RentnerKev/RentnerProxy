FROM mirror.gcr.io/library/rust:1.99.1-trixie@sha256:09027f873d45b8ecd1dc86f1fa13b7a62b875c961f017a0e331267b350430137 AS builder

WORKDIR /build
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
ARG RENTNERPROXY_BUILD_VERSION
RUN RENTNERPROXY_BUILD_VERSION="$RENTNERPROXY_BUILD_VERSION" cargo build --locked --release

FROM mirror.gcr.io/library/golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS caddy-go-toolchain

# The builder supplies CADDY_VERSION so image updates also update the compiled binary.
# Apply the reviewed reload-lifecycle backport to a verified upstream copy.
# Their optional AppSec and Layer 4 modules remain unconfigured.
FROM mirror.gcr.io/library/caddy:2.11.9-builder@sha256:3fddbec729442a56b942d4c9eaef1df80893dbf2cf5b86701bfae6aad1408eeb AS caddy-build

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

FROM mirror.gcr.io/library/debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4

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

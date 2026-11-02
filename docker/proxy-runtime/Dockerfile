FROM mirror.gcr.io/library/rust:1.99.1-trixie@sha256:09027f873d45b8ecd1dc86f1fa13b7a62b875c961f017a0e331267b350430137 AS builder

WORKDIR /build
COPY core/Cargo.toml core/Cargo.lock ./
COPY core/src ./src
ARG RENTNERPROXY_BUILD_VERSION
RUN RENTNERPROXY_BUILD_VERSION="$RENTNERPROXY_BUILD_VERSION" cargo build --locked --release

FROM mirror.gcr.io/library/golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS caddy-go-toolchain

# The builder supplies CADDY_VERSION so image updates also update the compiled binary.
# Use immutable upstream modules without changing their source.
# Their optional AppSec and Layer 4 modules remain unconfigured.
FROM mirror.gcr.io/library/caddy:2.11.7-builder@sha256:c4cd20eaa0b69112fd5d4f721ffc9671687e1d5d0b155c8620cf7546dbef94c0 AS caddy-build

RUN rm -rf /usr/local/go
COPY --from=caddy-go-toolchain /usr/local/go/ /usr/local/go/
ENV GOTOOLCHAIN=local CGO_ENABLED=0 GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org

ARG CADDY_CROWDSEC_BOUNCER_COMMIT=4a6ce1d3094dbfd270fecf2a91aaab81663d0cb4
ARG CADDY_LAYER4_VERSION=v0.1.3-0.20261029145729-f607ccea1b7d
COPY docker/caddy/tooling/verify-buildinfo.sh /tmp/verify-caddy-buildinfo.sh
COPY docker/caddy/tooling/build.sh /tmp/build-caddy.sh
COPY core/caddy-modules/responsecache/ /opt/rentnerproxy-responsecache/
WORKDIR /tmp/rentnerproxy-caddy
RUN /bin/sh /tmp/build-caddy.sh

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

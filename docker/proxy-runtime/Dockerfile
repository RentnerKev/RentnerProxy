# Development/integration runtime, not a production deployment stack.
FROM rust:1.97.1-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS builder

WORKDIR /build
COPY controller/Cargo.toml controller/Cargo.lock ./
COPY controller/src ./src
RUN cargo build --locked --release

FROM openresty/openresty:1.31.1.1-1-bookworm@sha256:4fdf7340201eed756bcce33b8642bf822f7b14dd6415f45e08ced5cc1924d617

COPY --from=builder /build/target/release/rentnerproxy-controller /usr/local/bin/rentnerproxy-controller
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/rentnerproxy/proxy \
    && chown 10001:10001 /var/lib/rentnerproxy/proxy
USER 10001:10001

ENV RENTNERPROXY_CONTROLLER_LISTEN_ADDR=0.0.0.0:8081 \
    RENTNERPROXY_PROXY_ENGINE_BIN=/usr/local/openresty/nginx/sbin/nginx \
    RENTNERPROXY_PROXY_STATE_DIR=/var/lib/rentnerproxy/proxy \
    RENTNERPROXY_PROXY_HTTP_PORT=8080 \
    RENTNERPROXY_PROXY_HTTPS_PORT=8443 \
    RENTNERPROXY_SYSTEM_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 8080 8081 8443
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/rentnerproxy-controller"]
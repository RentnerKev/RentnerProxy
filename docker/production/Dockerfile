# syntax=docker/dockerfile:1

FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS web-dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM web-dependencies AS web-build

COPY . .
RUN bun run build:web \
    && bun build web/src/db/migrate.ts --target=bun --outfile=/build/migrate.js

FROM oven/bun:1.4.0@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6 AS web-runtime

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && rm -rf \
        node_modules/@happy-dom \
        node_modules/@tailwindcss \
        node_modules/@types \
        node_modules/@vitejs \
        node_modules/drizzle-kit \
        node_modules/fast-check \
        node_modules/oxfmt \
        node_modules/oxlint \
        node_modules/tailwindcss \
        node_modules/typescript \
        node_modules/vite
COPY --from=web-build /app/web/dist ./web/dist
COPY --from=web-build /app/web/drizzle ./web/drizzle
COPY --from=web-build /build/migrate.js ./migrate.js
COPY --from=web-build /app/docker/web/bootstrap-secrets.mjs ./docker/web/bootstrap-secrets.mjs
COPY --from=web-build /app/docker/web/request-context.ts ./docker/web/request-context.ts
COPY --from=web-build /app/docker/web/serve.mjs ./docker/web/serve.mjs
COPY --from=web-build /app/docker/web/healthcheck.mjs ./docker/web/healthcheck.mjs

FROM rust:1.98.0-bookworm@sha256:82150a52ec202c1b14d7817e14516c392bb7f5cfebd88f1ed531cb37ebd39922 AS controller-build

WORKDIR /build
COPY controller/Cargo.toml controller/Cargo.lock ./
COPY controller/src ./src
RUN cargo build --locked --release

FROM openresty/openresty:1.31.1.1-2-bookworm@sha256:f03133864fb753a546a5393305a909296fae094725d0271fa07a4c6508ea4219 AS openresty-runtime

FROM redis:8.10.1-trixie@sha256:298e5b3bc566bade82f46ad5511777a4a07a294097ce16ada2f6a42be5239df5 AS redis-runtime

FROM postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280 AS runtime

LABEL org.opencontainers.image.source="https://github.com/RentnerKev/RentnerProxy" \
    org.opencontainers.image.description="A zero-configuration RentnerProxy appliance"

ENV APP_DIR=/opt/rentnerproxy/web \
    NODE_ENV=production \
    PGDATA=/var/lib/rentnerproxy/postgres-data \
    RENTNERPROXY_PROXY_ENGINE_BIN=/usr/local/openresty/nginx/sbin/nginx \
    RENTNERPROXY_PROXY_HTTP_PORT=8080 \
    RENTNERPROXY_PROXY_HTTPS_PORT=8443 \
    RENTNERPROXY_PROXY_STATE_DIR=/var/lib/rentnerproxy/proxy \
    RENTNERPROXY_SYSTEM_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 rentnerproxy \
    && useradd --uid 10001 --gid rentnerproxy --no-create-home --shell /usr/sbin/nologin rentnerproxy \
    && install -d -m 0711 -o root -g root /var/lib/rentnerproxy \
    && install -d -m 0700 -o postgres -g postgres /var/lib/rentnerproxy/postgres-data \
    && install -d -m 0700 -o rentnerproxy -g rentnerproxy /var/lib/rentnerproxy/proxy \
    && install -d -m 0700 -o root -g root /var/lib/rentnerproxy/bootstrap \
    && install -d -m 0700 -o postgres -g postgres /var/run/postgresql \
    && chmod 00700 /var/run/postgresql \
    && install -d -m 0755 /opt/rentnerproxy/redis/bin

COPY --from=web-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=web-runtime /app /opt/rentnerproxy/web
COPY --from=controller-build /build/target/release/rentnerproxy-controller /usr/local/bin/rentnerproxy-controller
COPY --from=openresty-runtime /usr/local/openresty /usr/local/openresty
COPY --from=redis-runtime /usr/local/bin/redis-server /usr/local/bin/redis-cli /opt/rentnerproxy/redis/bin/
COPY docker/production/entrypoint.sh /usr/local/bin/rentnerproxy-production

RUN chmod 0555 /usr/local/bin/rentnerproxy-production \
    && chmod 0555 /usr/local/bin/rentnerproxy-controller \
    && chmod 0555 /usr/local/bin/bun \
    && chmod 0555 /opt/rentnerproxy/redis/bin/redis-server /opt/rentnerproxy/redis/bin/redis-cli

EXPOSE 3000 8080 8443
VOLUME ["/var/lib/rentnerproxy"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=12 CMD ["bun", "/opt/rentnerproxy/web/docker/web/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/rentnerproxy-production"]

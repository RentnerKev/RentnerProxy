FROM oven/bun:1.4.1@sha256:9e123d5fc069e29d519fd4c981afb61b8542ac80274771961136db1e4538d53e AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN bun run build:web
RUN bun build web/src/db/migrate.ts --target=bun --outfile=/build/migrate.js

FROM oven/bun:1.4.1@sha256:9e123d5fc069e29d519fd4c981afb61b8542ac80274771961136db1e4538d53e AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

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
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/web/drizzle ./web/drizzle
COPY --from=build /build/migrate.js ./migrate.js
COPY --from=build /app/docker/web/bootstrap-secrets.mjs ./docker/web/bootstrap-secrets.mjs
COPY --from=build /app/docker/web/request-context.ts ./docker/web/request-context.ts
COPY --from=build /app/docker/web/serve.mjs ./docker/web/serve.mjs
COPY --from=build /app/docker/web/healthcheck.mjs ./docker/web/healthcheck.mjs

USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["bun", "docker/web/serve.mjs"]

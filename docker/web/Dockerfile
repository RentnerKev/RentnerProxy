FROM mirror.gcr.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .
ARG RENTNERPROXY_BUILD_VERSION
RUN RENTNERPROXY_BUILD_VERSION="$RENTNERPROXY_BUILD_VERSION" bun run build:web
RUN bun build web/src/db/migrate.ts --target=bun --outfile=/build/migrate.js \
    && bun docker/web/package-migrations.ts ./web/drizzle /build/migrations

FROM mirror.gcr.io/oven/bun:1.4.3@sha256:ec06c3b6cea04192ae6770c434f668ca41d343ad19fa6472216c7b48be39c598 AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json bun.lock ./
COPY docker/web/prune-build-tools.sh /tmp/prune-build-tools.sh
RUN bun install --frozen-lockfile --production \
    && /bin/sh /tmp/prune-build-tools.sh \
    && rm /tmp/prune-build-tools.sh \
    && bun --no-env-file -e "import { format } from 'oxfmt'; const result = await format('default-site.html', '<style>h1{color:red}</style>', { tabWidth: 4, printWidth: 100, htmlWhitespaceSensitivity: 'strict' }); if (result.errors.length || !result.code.includes('color: red;')) throw new Error('Runtime HTML formatter failed')"
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /build/migrations ./web/drizzle
COPY --from=build /build/migrate.js ./migrate.js
COPY --from=build /app/docker/web/bootstrap-secrets.mjs ./docker/web/bootstrap-secrets.mjs
COPY --from=build /app/docker/web/request-context.ts ./docker/web/request-context.ts
COPY --from=build /app/docker/web/static-assets.ts ./docker/web/static-assets.ts
COPY --from=build /app/docker/web/serve.mjs ./docker/web/serve.mjs
COPY --from=build /app/docker/web/healthcheck.mjs ./docker/web/healthcheck.mjs

USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["bun", "docker/web/serve.mjs"]

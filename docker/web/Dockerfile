FROM mirror.gcr.io/oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS dependencies

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build

COPY . .
ARG RENTNERPROXY_BUILD_VERSION
RUN RENTNERPROXY_BUILD_VERSION="$RENTNERPROXY_BUILD_VERSION" bun run build:web
RUN bun build web/src/db/migrate.ts --target=bun --outfile=/build/migrate.js \
    && bun docker/web/package-migrations.ts ./web/drizzle /build/migrations

FROM mirror.gcr.io/oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json bun.lock ./
COPY docker/web/prune-build-tools.sh /tmp/prune-build-tools.sh
RUN bun install --frozen-lockfile --production \
    && /bin/sh /tmp/prune-build-tools.sh \
    && rm /tmp/prune-build-tools.sh \
    && bun --no-env-file -e "const result = Bun.spawnSync([process.execPath, '--no-env-file', 'fmt', '--no-script', '--no-config', '--no-editorconfig', '--stdin-filepath=default-site.html', '--tab-width=4', '--print-width=100', '--html-whitespace-sensitivity=strict', '--threads=1'], { stdin: Buffer.from('<style>h1{color:red}</style>'), stdout: 'pipe', stderr: 'pipe', timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 262144 }); if (result.exitCode !== 0 || !result.stdout.toString().includes('color: red;')) throw new Error('Runtime HTML formatter failed')"
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /build/migrations ./web/drizzle
COPY --from=build /build/migrate.js ./migrate.js
COPY --from=build /app/docker/web/bootstrap-secrets.ts ./docker/web/bootstrap-secrets.ts
COPY --from=build /app/docker/web/request-context.ts ./docker/web/request-context.ts
COPY --from=build /app/docker/web/static-assets.ts ./docker/web/static-assets.ts
COPY --from=build /app/docker/web/serve.ts ./docker/web/serve.ts
COPY --from=build /app/docker/web/healthcheck.ts ./docker/web/healthcheck.ts

USER bun
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["bun", "docker/web/serve.ts"]

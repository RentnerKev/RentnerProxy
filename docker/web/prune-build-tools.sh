#!/bin/sh

set -eu

# Production installs may retain optional tool peers and platform binaries.
# Remove their complete package owners, retaining the server's runtime packages.
test -d node_modules
rm -rf \
    node_modules/@esbuild \
    node_modules/@esbuild-kit \
    node_modules/@happy-dom \
    node_modules/@oxfmt \
    node_modules/@tailwindcss \
    node_modules/@types \
    node_modules/@vitejs \
    node_modules/drizzle-kit \
    node_modules/esbuild \
    node_modules/fast-check \
    node_modules/oxfmt \
    node_modules/oxlint \
    node_modules/tailwindcss \
    node_modules/tsx \
    node_modules/vite

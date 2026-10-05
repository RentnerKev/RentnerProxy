#!/usr/bin/env bash
set -Eeuo pipefail
revision="$(git -C source rev-parse HEAD)"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || {
    echo '::error::The main checkout has no valid commit.'
    exit 1
}
repository="${GITHUB_REPOSITORY,,}"
[[ "$repository" =~ ^[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*$ ]] || {
    echo '::error::The repository name cannot be used as a GHCR image name.'
    exit 1
}
[[ -s source/docker/production/Dockerfile ]] || {
    echo '::error::The production Dockerfile is missing or empty.'
    exit 1
}
[[ -s source/docker/production/Dockerfile.dockerignore ]] || {
    echo '::error::The Docker ignore file is missing or empty.'
    exit 1
}
if ! grep -Fq '**/.env' source/docker/production/Dockerfile.dockerignore ||
    ! grep -Fq '**/*.key' source/docker/production/Dockerfile.dockerignore; then
    echo '::error::The Docker context does not exclude environment and key files.'
    exit 1
fi
{
    printf 'image=ghcr.io/%s\n' "$repository"
    printf 'revision=%s\n' "$revision"
    printf 'version=dev-%.12s\n' "$revision"
} >> "$GITHUB_OUTPUT"

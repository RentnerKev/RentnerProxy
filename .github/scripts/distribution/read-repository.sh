#!/bin/bash
set -Eeuo pipefail
: "${AUTOMATION_DIRECTORY:?}" "${REPOSITORY_DIRECTORY:?}" "${RUNNER_TEMP:?}"
[[ "$REPOSITORY_DIRECTORY" == "$RUNNER_TEMP"/package-repository ]] || exit 1
mkdir "$REPOSITORY_DIRECTORY"
git -c core.hooksPath=/dev/null init --quiet "$REPOSITORY_DIRECTORY"
git -C "$REPOSITORY_DIRECTORY" remote add origin https://github.com/RentnerKev/RentnerProxy.git
remote=$(git ls-remote --exit-code https://github.com/RentnerKev/RentnerProxy.git refs/heads/package-repository) || status=$?
if [[ ${status:-0} == 2 ]]; then
    mkdir "$REPOSITORY_DIRECTORY/public"
    printf '%s\n' initial > "$REPOSITORY_DIRECTORY/.git/rentnerproxy-parent"
elif [[ ${status:-0} == 0 && "$remote" =~ ^[a-f0-9]{40}[[:space:]]refs/heads/package-repository$ ]]; then
    git -C "$REPOSITORY_DIRECTORY" fetch --depth 1 origin refs/heads/package-repository
    git -C "$REPOSITORY_DIRECTORY" ls-tree --full-tree -rz FETCH_HEAD > "$RUNNER_TEMP/package-repository-tree"
    bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/distribution/publication.ts" validate-tree "$RUNNER_TEMP/package-repository-tree"
    git -C "$REPOSITORY_DIRECTORY" -c core.hooksPath=/dev/null checkout --quiet --detach FETCH_HEAD
    git -C "$REPOSITORY_DIRECTORY" rev-parse HEAD > "$REPOSITORY_DIRECTORY/.git/rentnerproxy-parent"
else
    printf '%s\n' 'Cannot establish the package repository history.' >&2
    exit 1
fi

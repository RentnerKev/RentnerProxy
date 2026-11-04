#!/bin/bash
set -Eeuo pipefail
umask 077
: "${REPOSITORY_DIRECTORY:?}" "${RUNNER_TEMP:?}" "${GH_TOKEN:?}"
[[ "$REPOSITORY_DIRECTORY" == "$RUNNER_TEMP"/package-repository ]] || exit 1
git -C "$REPOSITORY_DIRECTORY" add -- public
if ! git -C "$REPOSITORY_DIRECTORY" diff --cached --quiet; then
    git -C "$REPOSITORY_DIRECTORY" -c core.hooksPath=/dev/null -c user.name=rentnerproxy-release-bot -c user.email=rentnerproxy-release-bot@users.noreply.github.com commit --quiet -m 'release: refresh signed Linux package repository'
fi
git -C "$REPOSITORY_DIRECTORY" ls-tree --full-tree -rz HEAD > "$RUNNER_TEMP/package-repository-tree"
bun --no-env-file "$AUTOMATION_DIRECTORY/.github/scripts/distribution/publication.ts" validate-tree "$RUNNER_TEMP/package-repository-tree"
askpass=$(mktemp "$RUNNER_TEMP/package-askpass-XXXXXXXX")
trap 'rm -f -- "$askpass"' EXIT
cat > "$askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
    *Username*) printf '%s\n' x-access-token ;;
    *Password*) printf '%s\n' "$GH_TOKEN" ;;
    *) exit 1 ;;
esac
ASKPASS
chmod 0700 "$askpass"
# A normal non-force push is the compare-and-swap. A concurrent owner edit fails closed.
GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git -C "$REPOSITORY_DIRECTORY" -c credential.helper= -c core.hooksPath=/dev/null push origin HEAD:refs/heads/package-repository

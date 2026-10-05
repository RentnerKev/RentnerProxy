#!/usr/bin/env bash
set -Eeuo pipefail
revision="$(git -C source rev-parse HEAD)"
tag_revision="$(git -C source rev-list -n 1 "refs/tags/$RELEASE_TAG")"
if [[ "$revision" != "$EXPECTED_REVISION" || "$tag_revision" != "$EXPECTED_REVISION" ]]; then
    echo "::error::Build checkout does not match the prepared release commit."
    exit 1
fi

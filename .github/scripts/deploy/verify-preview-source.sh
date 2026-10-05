#!/usr/bin/env bash
set -Eeuo pipefail
actual_sha="$(git -C source rev-parse HEAD)"
if [[ "$actual_sha" != "$EXPECTED_TESTED_SHA" ]]; then
    echo '::error::Preview build checkout does not match the tested merge commit.'
    exit 1
fi
test -s source/docker/production/Dockerfile || {
    echo '::error::Preview build Dockerfile is missing or empty.'
    exit 1
}

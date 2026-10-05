#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo '::error::Docker build returned no valid image digest.'
    exit 1
}
for _ in {1..6}; do
    actual_digest="$(
        docker buildx imagetools inspect "$IMAGE:dev" \
            --format '{{.Manifest.Digest}}' 2>/dev/null || true
    )"
    if [[ "$actual_digest" == "$EXPECTED_DIGEST" ]]; then
        exit 0
    fi
    sleep 5
done
echo '::error::The published :dev tag does not resolve to the built digest.'
exit 1

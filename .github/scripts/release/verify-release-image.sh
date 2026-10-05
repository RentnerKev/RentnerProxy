#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$EXPECTED_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "::error::Docker build returned no valid image digest."
    exit 1
}

verify_reference() {
    local reference=$1
    local actual_digest=''
    for _ in {1..6}; do
        actual_digest="$(
            docker buildx imagetools inspect "$reference" \
                --format '{{.Manifest.Digest}}' 2>/dev/null || true
        )"
        if [[ "$actual_digest" == "$EXPECTED_DIGEST" ]]; then
            return 0
        fi
        sleep 5
    done
    echo "::error::Published image $reference did not resolve to the expected digest."
    return 1
}

verify_reference "$IMAGE:$RELEASE_TAG"
verify_reference "$IMAGE:$CHANNEL_TAG"

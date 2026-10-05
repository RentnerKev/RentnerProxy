#!/usr/bin/env bash
set -Eeuo pipefail

semver_pattern='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$'
if (( ${#RELEASE_TAG} > 128 )) || [[ ! "$RELEASE_TAG" =~ $semver_pattern ]]; then
    echo "::error::Invalid release tag. Expected v1.2.3, v1.2.3-alpha.1 or v1.2.3-beta.1."
    exit 1
fi

prerelease_part="${BASH_REMATCH[5]:-}"
if [[ -n "$prerelease_part" ]]; then
    IFS='.' read -ra identifiers <<< "$prerelease_part"
    for identifier in "${identifiers[@]}"; do
        if [[ "$identifier" =~ ^[0-9]+$ && "${#identifier}" -gt 1 && "$identifier" == 0* ]]; then
            echo "::error::Invalid release tag. Numeric prerelease identifiers cannot have leading zeroes."
            exit 1
        fi
    done
fi

case "$prerelease_part" in
    alpha|alpha.*) expected_channel=alpha ;;
    beta|beta.*) expected_channel=beta ;;
    '') expected_channel=stable ;;
    *)
        echo "::error::Only alpha, beta and stable release tags are supported."
        exit 1
        ;;
esac
expected_prerelease=true
[[ "$expected_channel" != stable ]] || expected_prerelease=false
if [[ "$RELEASE_CHANNEL" != "$expected_channel" || "$RELEASE_PRERELEASE" != "$expected_prerelease" ]]; then
    echo "::error::Release channel and GitHub prerelease state must match the version tag."
    exit 1
fi

[[ "$RELEASE_ID" =~ ^[1-9][0-9]*$ ]] || {
    echo "::error::No valid GitHub release metadata was provided."
    exit 1
}
[[ -n "$RELEASE_PUBLISHED_AT" ]] || {
    echo "::error::The GitHub release publication timestamp is missing."
    exit 1
}

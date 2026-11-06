#!/usr/bin/env bash
set -Eeuo pipefail
artifact_directory="$RUNNER_TEMP/rentnerproxy-release"
expected_changelog="RentnerProxy-$RELEASE_TAG-CHANGELOG.md"
[[ "$CHANGELOG_FILENAME" == "$expected_changelog" ]] || {
    echo "::error::Prepared changelog filename does not match the release tag."
    exit 1
}
[[ -s "$artifact_directory/release-body.md" ]] || {
    echo "::error::Prepared release body is missing or empty."
    exit 1
}
[[ -s "$artifact_directory/$CHANGELOG_FILENAME" ]] || {
    echo "::error::Prepared changelog is missing or empty."
    exit 1
}
[[ -s "$artifact_directory/release-banner.png" ]] || {
    echo "::error::Prepared release banner is missing or empty."
    exit 1
}
png_signature="$(
    od -An -t x1 -N8 "$artifact_directory/release-banner.png" | tr -d ' \n'
)"
[[ "$png_signature" == '89504e470d0a1a0a' ]] || {
    echo "::error::Prepared release banner is not a valid PNG."
    exit 1
}

shopt -s nullglob
for contributor_asset in "$artifact_directory"/contributor-*.svg; do
    contributor_name="$(basename "$contributor_asset")"
    [[ "$contributor_name" =~ ^contributor-[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?\.svg$ &&
       -f "$contributor_asset" && ! -L "$contributor_asset" && -s "$contributor_asset" ]] || {
        echo "::error::A prepared contributor avatar is invalid."
        exit 1
    }
    [[ "$(wc -c < "$contributor_asset")" -le 1048576 ]] || {
        echo "::error::A prepared contributor avatar exceeds the size limit."
        exit 1
    }
done

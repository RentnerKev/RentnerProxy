#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
bash "$script_directory/validate-release-event.sh"
bash "$script_directory/verify-release-identity.sh"

banner_path="$script_directory/../../assets/release-banners/building-release-banner.png"
[[ -s "$banner_path" ]] || {
    echo "::error::The building release banner is missing or empty."
    exit 1
}
png_signature="$(od -An -t x1 -N8 "$banner_path" | tr -d ' \n')"
[[ "$png_signature" == '89504e470d0a1a0a' ]] || {
    echo "::error::The building release banner is not a valid PNG."
    exit 1
}
artifact_directory="$RUNNER_TEMP/rentnerproxy-release"
mkdir -p "$artifact_directory"
cp "$banner_path" "$artifact_directory/building-banner.png"
bun --no-env-file "$script_directory/generate-building-release-notes.ts"
[[ -s "$artifact_directory/building-body.md" ]] || {
    echo "::error::The building release body is missing or empty."
    exit 1
}

bash "$script_directory/verify-release-identity.sh"
gh release upload "$RELEASE_TAG" "$artifact_directory/building-banner.png" \
    --clobber --repo "$GITHUB_REPOSITORY"
bash "$script_directory/verify-release-identity.sh"
gh release edit "$RELEASE_TAG" --notes-file "$artifact_directory/building-body.md" \
    --repo "$GITHUB_REPOSITORY"

release_assets="$(
    gh api "repos/$GITHUB_REPOSITORY/releases/$RELEASE_ID/assets" --paginate \
        --jq '.[] | [.id, .name] | @tsv'
)" || {
    echo "::error::Listing stale release control assets failed."
    exit 1
}
for control_asset in 'rentnerproxy-update.json' 'release-banner.png' "RentnerProxy-$RELEASE_TAG-CHANGELOG.md" 'contributor-*.svg'; do
    while IFS=$'\t' read -r asset_id asset_name; do
        if [[ "$control_asset" == 'contributor-*.svg' ]]; then
            [[ "$asset_name" =~ ^contributor-[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?\.svg$ ]] || continue
        else
            [[ "$asset_name" == "$control_asset" ]] || continue
        fi
        [[ "$asset_id" =~ ^[1-9][0-9]*$ ]] || {
            echo "::error::A stale release control asset has an invalid identifier."
            exit 1
        }
        bash "$script_directory/verify-release-identity.sh"
        gh api --method DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$asset_id" || {
            echo "::error::Removing a stale release control asset failed."
            exit 1
        }
    done <<< "$release_assets"
done

#!/usr/bin/env bash
set -Eeuo pipefail

tag_ref="refs/tags/$RELEASE_TAG"
git -C source show-ref --verify --quiet "$tag_ref" || {
    echo "::error::Release tag $RELEASE_TAG does not exist in the checkout."
    exit 1
}
revision="$(git -C source rev-parse HEAD)"
tag_revision="$(git -C source rev-list -n 1 "$tag_ref")"
[[ "$revision" == "$tag_revision" ]] || {
    echo "::error::Checked-out HEAD does not match the authoritative release tag."
    exit 1
}

dockerfile_relative='docker/production/Dockerfile'
dockerignore_relative='docker/production/Dockerfile.dockerignore'
[[ -s "source/$dockerfile_relative" ]] || {
    echo "::error::Release Dockerfile is missing or empty: $dockerfile_relative"
    exit 1
}
[[ -s "source/$dockerignore_relative" ]] || {
    echo "::error::Release Docker ignore file is missing or empty: $dockerignore_relative"
    exit 1
}
if ! grep -Fq '**/.env' "source/$dockerignore_relative" ||
    ! grep -Fq '**/*.key' "source/$dockerignore_relative"; then
    echo "::error::Release Docker context does not exclude environment and key files."
    exit 1
fi

repository="${GITHUB_REPOSITORY,,}"
[[ "$repository" =~ ^[a-z0-9][a-z0-9_.-]*/[a-z0-9][a-z0-9_.-]*$ ]] || {
    echo "::error::The repository name cannot be normalized into a safe GHCR image name."
    exit 1
}
image="ghcr.io/$repository"

case "$RELEASE_CHANNEL" in
    alpha)
        banner_relative='.github/assets/release-banners/alpha-release-banner.png'
        channel_tag=alpha
        ;;
    beta)
        banner_relative='.github/assets/release-banners/beta-release-banner.png'
        channel_tag=beta
        ;;
    stable)
        banner_relative='.github/assets/release-banners/new-release-banner.png'
        channel_tag=latest
        ;;
    *)
        echo "::error::Unsupported release channel."
        exit 1
        ;;
esac

banner_path="source/$banner_relative"
[[ -s "$banner_path" ]] || {
    echo "::error::Required release banner is missing or empty: $banner_relative"
    exit 1
}
png_signature="$(od -An -t x1 -N8 "$banner_path" | tr -d ' \n')"
[[ "$png_signature" == '89504e470d0a1a0a' ]] || {
    echo "::error::Required release banner is not a valid PNG: $banner_relative"
    exit 1
}

output_directory="$RUNNER_TEMP/rentnerproxy-release"
mkdir -p "$output_directory"
cp "$banner_path" "$output_directory/release-banner.png"
changelog_filename="RentnerProxy-$RELEASE_TAG-CHANGELOG.md"

{
    printf 'channel_tag=%s\n' "$channel_tag"
    printf 'changelog_filename=%s\n' "$changelog_filename"
    printf 'image=%s\n' "$image"
    printf 'revision=%s\n' "$revision"
} >> "$GITHUB_OUTPUT"

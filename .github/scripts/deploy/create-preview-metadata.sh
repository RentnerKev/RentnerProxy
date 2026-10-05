#!/usr/bin/env bash
set -Eeuo pipefail
artifact_directory="$RUNNER_TEMP/pr-preview-artifact"
oci_archive="$artifact_directory/preview-image.tar"
oci_sha256="$(sha256sum "$oci_archive" | cut -d ' ' -f 1)"
created_at="$(date --utc '+%Y-%m-%dT%H:%M:%S.000Z')"

jq --null-input \
    --arg artifactName 'pr-preview-image' \
    --arg baseSha "$BASE_SHA" \
    --arg createdAt "$created_at" \
    --arg headRepository "$HEAD_REPOSITORY" \
    --arg headSha "$HEAD_SHA" \
    --arg ociSha256 "$oci_sha256" \
    --arg platform "$PREVIEW_PLATFORM" \
    --arg repository "$REPOSITORY" \
    --arg testedSha "$TESTED_SHA" \
    --argjson pullRequestNumber "$PR_NUMBER" \
    --argjson runAttempt "$GITHUB_RUN_ATTEMPT" \
    --argjson runId "$GITHUB_RUN_ID" \
    --argjson triggerRunId "$TRIGGER_RUN_ID" \
    '{
        schemaVersion: 1,
        artifactName: $artifactName,
        repository: $repository,
        pullRequestNumber: $pullRequestNumber,
        headRepository: $headRepository,
        headSha: $headSha,
        baseSha: $baseSha,
        testedSha: $testedSha,
        runId: $runId,
        runAttempt: $runAttempt,
        triggerRunId: $triggerRunId,
        platform: $platform,
        createdAt: $createdAt,
        ociSha256: $ociSha256
    }' > "$artifact_directory/metadata.json"

import { runCommand } from './pr-preview/commands.ts'

export {
    parsePositiveInteger,
    validateFullSha,
    parsePullRequestLifecycle,
    parseTestedShaProof,
    parsePullRequestNumberProof,
    normalizeWorkflowPath,
    assertPreviewTag,
    createPreviewIdentity,
    assertPreviewPublishPlan,
    assertMatchingPreviewDigests,
} from './pr-preview/validation.ts'
export {
    evaluateRequiredChecks,
    evaluatePullRequest,
    assertPullRequestBranchUpToDate,
} from './pr-preview/checks.ts'
export { actionsRunIdFromDetailsUrl, assertWorkflowRunPullRequest } from './pr-preview/gate.ts'
export { parsePreviewArtifactMetadata } from './pr-preview/artifacts.ts'
export {
    PREVIEW_COMMENT_MARKER,
    selectPreviewComment,
    renderPreviewComment,
    parsePreviewComment,
} from './pr-preview/comments.ts'

if (import.meta.main) {
    runCommand().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown PR preview failure.'
        console.error(message.replace(/[\r\n\0]/gu, ' '))
        process.exitCode = 1
    })
}

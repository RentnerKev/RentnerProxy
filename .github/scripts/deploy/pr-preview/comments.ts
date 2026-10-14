import type { PreviewIdentity, PreviewComment } from '../Types/pr-preview.types.ts'
import {
    asRecord,
    stringValue,
    parsePositiveInteger,
    validateFullSha,
    validateSha256Digest,
} from './validation.ts'
import { GitHubApi } from './github-api.ts'

export const PREVIEW_COMMENT_MARKER = '<!-- rentnerproxy-pr-preview -->'

export function selectPreviewComment(comments: readonly PreviewComment[]): PreviewComment | null {
    return (
        comments
            .filter(
                (comment) =>
                    comment.userLogin === 'github-actions[bot]' &&
                    comment.userType === 'Bot' &&
                    comment.body?.trimStart().startsWith(PREVIEW_COMMENT_MARKER) === true,
            )
            .toSorted((left, right) => right.id - left.id)[0] ?? null
    )
}

export function renderPreviewComment(
    identity: PreviewIdentity,
    headShaValue: unknown,
    digestValue: unknown,
): string {
    const headSha = validateFullSha(headShaValue, 'PR head SHA')
    const digest = validateSha256Digest(digestValue, 'Image digest')
    const projectName = `rentnerproxy-pr-${identity.pullRequestNumber}`

    return [
        PREVIEW_COMMENT_MARKER,
        '',
        '## 🐳 RentnerProxy PR Preview',
        '',
        'A test-only image for this pull request has been published successfully.',
        '',
        '### Images',
        '',
        '| Type | Image |',
        '| --- | --- |',
        `| Moving preview for this PR | \`${identity.movingReference}\` |`,
        `| Exact tested build | \`${identity.immutableReference}\` |`,
        '',
        `Image digest: \`${digest}\``,
        '',
        `Tested and built merge commit: \`${identity.testedSha}\``,
        '',
        `Pull request head commit: \`${headSha}\``,
        '',
        `For reproducible testing and bug reports, prefer \`${identity.immutableTag}\`. ` +
            `The \`${identity.movingTag}\` tag moves to the newest successful preview for this PR.`,
        '',
        '---',
        '',
        '### ⚠️ Unreviewed development preview',
        '',
        'This image contains unreviewed pull-request code. It may contain bugs, breaking changes, ' +
            'incomplete or incompatible migrations, configuration errors, and changes that damage data or runtime state.',
        '',
        '**Do not use this PR preview image with production data.**',
        '',
        'Before testing:',
        '',
        '1. Back up PostgreSQL.',
        '2. Back up the complete RentnerProxy controller/runtime state in `/var/lib/rentnerproxy`, ' +
            'including certificates, private keys, ACME state, active configuration, last-known-good state, and trusted CA material.',
        '3. Prefer a separate test database and separate Docker volumes.',
        '4. Use an isolated Docker Compose project and avoid production port bindings.',
        '',
        '### Docker',
        '',
        '```bash',
        `docker pull ${identity.immutableReference}`,
        '```',
        '',
        '### Docker Compose',
        '',
        'In a separate test copy of `docker-compose.yml`, replace the service image with:',
        '',
        '```yaml',
        `image: ${identity.immutableReference}`,
        '```',
        '',
        'Then use an isolated Compose project:',
        '',
        '```bash',
        `docker compose --project-name ${projectName} pull`,
        `docker compose --project-name ${projectName} up -d`,
        '```',
        '',
        'The repository Compose file binds ports 80, 81, and 443; change those bindings or stop the production stack before testing.',
        '',
        'This preview is intended only for testing this pull request and is not a production release.',
    ].join('\n')
}

export function parsePreviewComment(value: unknown): PreviewComment {
    const comment = asRecord(value, 'Pull request comment')
    const user = asRecord(comment.user, 'Pull request comment user')
    const body = comment.body
    if (body !== null && (typeof body !== 'string' || body.includes('\0'))) {
        throw new Error('Pull request comment body is invalid.')
    }
    return {
        body,
        id: parsePositiveInteger(comment.id, 'Pull request comment ID'),
        userLogin: stringValue(user.login, 'Pull request comment login'),
        userType: stringValue(user.type, 'Pull request comment user type'),
    }
}

export async function upsertPreviewComment(
    api: GitHubApi,
    pullRequestNumber: number,
    body: string,
): Promise<void> {
    const comments = (
        await api.arrayPages(`/repos/${api.repository}/issues/${pullRequestNumber}/comments`)
    ).map(parsePreviewComment)
    const existing = selectPreviewComment(comments)
    if (existing) {
        await api.request(`/repos/${api.repository}/issues/comments/${existing.id}`, {
            body: { body },
            method: 'PATCH',
        })
        console.log(`Updated PR preview comment ${existing.id}.`)
        return
    }
    await api.request(`/repos/${api.repository}/issues/${pullRequestNumber}/comments`, {
        body: { body },
        method: 'POST',
    })
    console.log('Created PR preview comment.')
}

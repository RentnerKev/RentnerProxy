import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readBoundedStream } from '../../../web/src/lib/Http/readBoundedStream.ts'
import {
    contributorAvatarAssetName,
    contributorLogins,
    renderContributorAvatar,
} from '../lib/contributor-avatars.ts'
import type { GitHubIssue } from '../lib/Types/release-notes.types.ts'
import type { FetchImplementation } from './Types/generate-release-notes.types.ts'

async function avatarBytes(login: string, fetcher: FetchImplementation): Promise<Uint8Array> {
    const signal = AbortSignal.timeout(10_000)
    let url = new URL(`https://github.com/${encodeURIComponent(login)}.png?size=96`)
    for (let redirects = 0; redirects <= 3; redirects += 1) {
        if (!['https://github.com', 'https://avatars.githubusercontent.com'].includes(url.origin))
            throw new Error('Contributor image redirect is not trusted')
        // oxlint-disable-next-line no-await-in-loop -- Follow only the preceding trusted redirect under one deadline.
        const response = await fetcher(url, { redirect: 'manual', signal })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            // oxlint-disable-next-line no-await-in-loop -- Release this response before following the redirect.
            await response.body?.cancel()
            if (!location) throw new Error('Contributor image redirect is missing its destination')
            url = new URL(location, url)
            continue
        }
        if (!response.ok || !response.body) {
            // oxlint-disable-next-line no-await-in-loop -- Release a failed response before aborting preparation.
            await response.body?.cancel()
            throw new Error('Contributor image could not be downloaded')
        }
        // oxlint-disable-next-line no-await-in-loop -- Consume only this response and enforce the complete byte/time bounds.
        return await readBoundedStream(response.body, 262_144, signal)
    }
    throw new Error('Too many contributor image redirects')
}

export async function prepareContributorAvatars(
    issues: readonly GitHubIssue[],
    directory: string,
    fetcher: FetchImplementation = fetch,
): Promise<void> {
    const logins = contributorLogins(issues)
    for (let index = 0; index < logins.length; index += 4) {
        // oxlint-disable-next-line no-await-in-loop -- Bound image download and encoding concurrency to four contributors.
        await Promise.all(
            logins.slice(index, index + 4).map(async (login) => {
                const bytes = await avatarBytes(login, fetcher)
                await writeFile(
                    join(directory, contributorAvatarAssetName(login)),
                    renderContributorAvatar(bytes),
                )
            }),
        )
    }
}

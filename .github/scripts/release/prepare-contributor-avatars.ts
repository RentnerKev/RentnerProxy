import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readBoundedStream } from '../../../web/src/lib/Http/readBoundedStream.ts'
import { runMaintenanceProcess } from '../../../scripts/backup/maintenance-process.ts'
import {
    contributorAvatarAssetName,
    contributorLogins,
    renderContributorAvatar,
} from '../lib/contributor-avatars.ts'
import type { GitHubIssue } from '../lib/Types/release-notes.types.ts'
import type { FetchImplementation } from './Types/generate-release-notes.types.ts'

function validateAvatarPng(bytes: Uint8Array): void {
    const png = Buffer.from(bytes)
    if (
        png.length < 45 ||
        png.length > 1_048_576 ||
        png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        png.subarray(12, 16).toString('ascii') !== 'IHDR' ||
        png.readUInt32BE(16) !== 96 ||
        png.readUInt32BE(20) !== 96 ||
        png[24] !== 8 ||
        png[25] !== 6 ||
        png.subarray(-12).toString('hex') !== '0000000049454e44ae426082'
    )
        throw new Error('Invalid rasterized contributor avatar')
}

export async function rasterizeContributorAvatar(
    svg: string,
    execute = runMaintenanceProcess,
): Promise<Uint8Array> {
    const result = await execute(['rsvg-convert', '--format=png'], {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
        input: new TextEncoder().encode(svg),
        timeoutMs: 10_000,
        maximumOutputBytes: 1_048_576,
    })
    if (result.failed || !result.stopped) throw new Error('Contributor avatar rasterization failed')
    validateAvatarPng(result.stdout)
    return result.stdout
}

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
    rasterize: (svg: string) => Promise<Uint8Array> = rasterizeContributorAvatar,
): Promise<void> {
    const logins = contributorLogins(issues)
    for (let index = 0; index < logins.length; index += 4) {
        // oxlint-disable-next-line no-await-in-loop -- Bound image download and encoding concurrency to four contributors.
        await Promise.all(
            logins.slice(index, index + 4).map(async (login) => {
                const bytes = await avatarBytes(login, fetcher)
                const png = await rasterize(renderContributorAvatar(bytes))
                validateAvatarPng(png)
                await writeFile(join(directory, contributorAvatarAssetName(login)), png)
            }),
        )
    }
}

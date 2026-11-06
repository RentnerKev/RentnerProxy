import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encode } from 'fast-png'
import {
    contributorAvatarAssetName,
    renderContributorAvatar,
} from '../../../../../.github/scripts/lib/contributor-avatars.ts'
import { prepareContributorAvatars } from '../../../../../.github/scripts/release/prepare-contributor-avatars.ts'
import type { GitHubIssue } from '../../../../../.github/scripts/lib/Types/release-notes.types.ts'

const image = new Uint8Array(
    encode({
        width: 2,
        height: 2,
        channels: 4,
        depth: 8,
        data: new Uint8Array(16).fill(255),
    }),
)
const issues: GitHubIssue[] = [
    { number: 1, title: 'Example', closed_at: null, labels: [], user: { login: 'Alice' } },
]

test('round avatars embed the original raster in a self-contained circular SVG', () => {
    const svg = renderContributorAvatar(image)
    expect(svg).toContain('viewBox="0 0 96 96"')
    expect(svg).toContain('<circle cx="48" cy="48" r="48"/>')
    expect(svg).toContain('clip-path="url(#avatar)"')
    const embedded = /href="data:image\/png;base64,([^"]+)"/u.exec(svg)![1]!
    expect(new Uint8Array(Buffer.from(embedded, 'base64'))).toEqual(image)
    expect(svg).not.toContain('style=')
    expect(svg).not.toContain('https://')
    expect(contributorAvatarAssetName('Alice')).toBe('contributor-alice.svg')
    expect(() => contributorAvatarAssetName('../escape')).toThrow()
    expect(() =>
        renderContributorAvatar(new TextEncoder().encode('<svg onload="alert(1)"/>')),
    ).toThrow()
    expect(() => renderContributorAvatar(new Uint8Array(262_145).fill(255))).toThrow()
})

test('downloads bounded public avatars without credentials and deduplicates contributors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-contributor-avatar-'))
    const requests: string[] = []
    try {
        await prepareContributorAvatars(
            [...issues, { ...issues[0]!, number: 2, user: { login: 'alice' } }],
            directory,
            async (input, init) => {
                requests.push(String(input))
                expect(new Headers(init?.headers).has('authorization')).toBe(false)
                expect(init?.redirect).toBe('manual')
                if (requests.length === 1)
                    return new Response(null, {
                        status: 302,
                        headers: { location: 'https://avatars.githubusercontent.com/u/1?s=96' },
                    })
                return new Response(image)
            },
        )
        expect(requests).toEqual([
            'https://github.com/alice.png?size=96',
            'https://avatars.githubusercontent.com/u/1?s=96',
        ])
        expect(await readdir(directory)).toEqual(['contributor-alice.svg'])
        expect(await readFile(join(directory, 'contributor-alice.svg'), 'utf8')).toBe(
            renderContributorAvatar(image),
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test.each(['redirect', 'oversize', 'unavailable', 'invalid-image'])(
    'failed avatar preparation cannot produce a publishable image: %s',
    async (mode) => {
        const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-contributor-avatar-'))
        try {
            let requests = 0
            await expect(
                prepareContributorAvatars(issues, directory, async () => {
                    requests += 1
                    if (mode === 'redirect')
                        return new Response(null, {
                            status: 302,
                            headers: { location: 'http://127.0.0.1/private' },
                        })
                    if (mode === 'oversize') return new Response(new Uint8Array(262_145))
                    if (mode === 'unavailable')
                        return new Response('not available', { status: 503 })
                    return new Response('<svg onload="alert(1)"/>')
                }),
            ).rejects.toThrow()
            expect(requests).toBe(1)
            expect(await readdir(directory)).toEqual([])
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    },
)

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import { createStaticAssetFetch } from '../../../docker/web/static-assets'

const server = { requestIP: () => null }
const temporaryDirectories: string[] = []
const fallback = () => new Response('application fallback', { status: 404 })

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => rm(directory, { force: true, recursive: true })),
    )
})

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'rentnerproxy-static-assets-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'assets', 'entry.js'), 'export const ready = true\n')
    await writeFile(join(root, 'assets', 'styles.css'), 'body { color: green }\n')
    await writeFile(join(root, 'rentnerproxy-logo.png'), 'public image fixture\n')
    return createStaticAssetFetch(root, fallback)
}

describe('runtime static assets', () => {
    test('serves packaged JavaScript, CSS, and public files with MIME and cache headers', async () => {
        const fetch = await fixture()
        const javascript = await fetch(new Request('http://localhost/assets/entry.js'), server)
        assert.equal(javascript.status, 200)
        assert.match(javascript.headers.get('content-type') ?? '', /^text\/javascript/u)
        assert.equal(javascript.headers.get('x-content-type-options'), 'nosniff')
        assert.match(javascript.headers.get('cache-control') ?? '', /immutable/u)
        assert.match(await javascript.text(), /ready/u)

        const css = await fetch(new Request('http://localhost/assets/styles.css'), server)
        assert.match(css.headers.get('content-type') ?? '', /^text\/css/u)
        assert.match(await css.text(), /color/u)

        const publicFile = await fetch(
            new Request('http://localhost/rentnerproxy-logo.png'),
            server,
        )
        assert.equal(publicFile.status, 200)
        assert.match(publicFile.headers.get('cache-control') ?? '', /max-age=3600/u)
    })

    test('supports HEAD and rejects mutation methods for existing files', async () => {
        const fetch = await fixture()
        const head = await fetch(
            new Request('http://localhost/assets/entry.js', { method: 'HEAD' }),
            server,
        )
        assert.equal(head.status, 200)
        assert.equal(await head.text(), '')
        assert.match(head.headers.get('content-type') ?? '', /^text\/javascript/u)

        const post = await fetch(
            new Request('http://localhost/assets/entry.js', { method: 'POST' }),
            server,
        )
        assert.equal(post.status, 405)
        assert.equal(post.headers.get('allow'), 'GET, HEAD')
    })

    test('keeps traversal, dotfiles, symlinks, and server bundle paths unavailable', async () => {
        const root = await mkdtemp(join(tmpdir(), 'rentnerproxy-static-assets-root-'))
        const outside = await mkdtemp(join(tmpdir(), 'rentnerproxy-static-assets-outside-'))
        temporaryDirectories.push(root, outside)
        await mkdir(join(root, 'assets'))
        await mkdir(join(outside, 'server'))
        await writeFile(join(root, 'assets', 'entry.js'), 'client\n')
        await writeFile(join(root, '.env'), 'private\n')
        await writeFile(join(outside, 'server', 'server.js'), 'private server bundle\n')
        await writeFile(join(outside, 'secret.txt'), 'private\n')
        try {
            await symlink(join(outside, 'secret.txt'), join(root, 'assets', 'link.txt'))
        } catch (error) {
            // Symlink creation can be unavailable on Windows CI; containment is still tested below.
            if (
                !(
                    error instanceof Error &&
                    'code' in error &&
                    ['EACCES', 'EPERM'].includes(String(error.code))
                )
            )
                throw error
        }
        const fetch = createStaticAssetFetch(root, () => new Response('fallback', { status: 404 }))
        const responses = await Promise.all(
            ['/assets/%2e%2e/secret.txt', '/.env', '/server/server.js', '/assets/link.txt'].map(
                (path) => fetch(new Request('http://localhost' + path), server),
            ),
        )
        const bodies = await Promise.all(responses.map((response) => response.text()))
        for (const [index, response] of responses.entries()) {
            expect(response.status).toBe(404)
            expect(bodies[index]).not.toContain('private')
        }
    })
})

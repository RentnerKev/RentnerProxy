import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { encode } from 'fast-png'
import {
    githubMediaRequest,
    publishReleaseMedia,
    repositoryMediaUrl,
} from '../../../../../.github/scripts/lib/release-media.ts'
import type { MediaRequest } from '../../../../../.github/scripts/lib/Types/release-media.types.ts'

const png = new Uint8Array(
    encode({ width: 96, height: 96, channels: 4, depth: 8, data: new Uint8Array(96 * 96 * 4) }),
)
const input = {
    repository: 'RentnerProxy/platform',
    tagName: 'v1.0.0-beta.3',
    files: [{ name: 'contributor-alice.png', bytes: png }],
}
const id = (value: string) => createHash('sha1').update(value).digest('hex')

function database() {
    let head: string | undefined
    let conflict = false
    let failUpdate = false
    const trees = new Map<string, { path: string; mode: string; type: string; sha: string }[]>()
    const commits = new Map<string, string>()
    const parents = new Map<string, string | undefined>()
    const calls: { method: string; endpoint: string; body: unknown }[] = []
    const request: MediaRequest = async (method, endpoint, payload) => {
        calls.push({ method, endpoint, body: payload })
        const body = payload as Record<string, unknown>
        if (endpoint === 'git/ref/heads/rentner/release-media')
            return head
                ? { status: 200, data: { object: { sha: head } } }
                : { status: 404, data: {} }
        if (method === 'GET' && endpoint.startsWith('git/commits/'))
            return { status: 200, data: { tree: { sha: commits.get(endpoint.slice(12)) } } }
        if (method === 'GET' && endpoint.startsWith('git/trees/'))
            return {
                status: 200,
                data: { tree: trees.get(endpoint.slice(10).split('?')[0]!), truncated: false },
            }
        if (endpoint === 'git/blobs') {
            const bytes = Buffer.from(body.content as string, 'base64')
            return {
                status: 201,
                data: {
                    sha: createHash('sha1')
                        .update(`blob ${bytes.length}\0`)
                        .update(bytes)
                        .digest('hex'),
                },
            }
        }
        if (endpoint === 'git/trees') {
            const merged = new Map(
                (trees.get(body.base_tree as string) ?? []).map((entry) => [entry.path, entry]),
            )
            for (const entry of body.tree as {
                path: string
                mode: string
                type: string
                sha: string
            }[])
                merged.set(entry.path, entry)
            const tree = [...merged.values()]
            const sha = id(JSON.stringify(tree))
            trees.set(sha, tree)
            return { status: 201, data: { sha } }
        }
        if (endpoint === 'git/commits') {
            const sha = id(JSON.stringify(body))
            commits.set(sha, body.tree as string)
            parents.set(sha, (body.parents as string[])[0])
            return { status: 201, data: { sha } }
        }
        if (endpoint === 'git/refs' || endpoint === 'git/refs/heads/rentner/release-media') {
            if (failUpdate) return { status: 403, data: {} }
            if (conflict) {
                conflict = false
                head = body.sha as string
                return { status: 422, data: {} }
            }
            if (
                (endpoint === 'git/refs' && head) ||
                (endpoint !== 'git/refs' && parents.get(body.sha as string) !== head)
            )
                return { status: 422, data: {} }
            head = body.sha as string
            return { status: 200, data: { object: { sha: head } } }
        }
        throw new Error(`Unexpected ${method} ${endpoint}`)
    }
    return {
        request,
        calls,
        conflict: () => {
            conflict = true
        },
        failUpdate: () => {
            failUpdate = true
        },
    }
}

test('creates a data-only orphan branch with immutable PNG URLs and reuses identical bytes', async () => {
    const db = database()
    const first = await publishReleaseMedia(input, db.request)
    expect(first.urls['contributor-alice.png']).toMatch(
        new RegExp(
            `^https://raw.githubusercontent.com/RentnerProxy/platform/${first.commitSha}/releases/v1.0.0-beta.3/[a-f0-9]{64}/contributor-alice.png$`,
        ),
    )
    const create = db.calls.find((call) => call.endpoint === 'git/commits')!
    expect(create.body).toMatchObject({ parents: [] })
    expect(db.calls.find((call) => call.endpoint === 'git/refs')?.body).toMatchObject({
        ref: 'refs/heads/rentner/release-media',
    })
    const mutations = db.calls.filter((call) => call.method !== 'GET').length
    expect(await publishReleaseMedia(input, db.request)).toEqual(first)
    expect(db.calls.filter((call) => call.method !== 'GET')).toHaveLength(mutations)
    expect(db.calls.every((call) => !call.endpoint.includes('releases/'))).toBe(true)
})

test('new bytes create a child and retain old media, with non-force updates', async () => {
    const db = database()
    const first = await publishReleaseMedia(input, db.request)
    const updated = new Uint8Array(
        encode({
            width: 96,
            height: 96,
            channels: 4,
            depth: 8,
            data: new Uint8Array(96 * 96 * 4).fill(255),
        }),
    )
    const second = await publishReleaseMedia(
        { ...input, files: [{ name: 'contributor-alice.png', bytes: updated }] },
        db.request,
    )
    expect(second.commitSha).not.toBe(first.commitSha)
    expect(second.urls['contributor-alice.png']).not.toBe(first.urls['contributor-alice.png'])
    expect(db.calls.findLast((call) => call.endpoint === 'git/commits')?.body).toMatchObject({
        parents: [first.commitSha],
    })
    expect(db.calls.findLast((call) => call.method === 'PATCH')?.body).toEqual({
        sha: second.commitSha,
        force: false,
    })
    const lastTree = db.calls.findLast((call) => call.endpoint === 'git/trees')!.body as Record<
        string,
        unknown
    >
    expect(lastTree.base_tree).toBeString()
    expect(await publishReleaseMedia(input, db.request)).toMatchObject({
        commitSha: second.commitSha,
    })
})

test('rechecks a concurrent winner and safely reuses its identical bytes', async () => {
    const db = database()
    db.conflict()
    await publishReleaseMedia(input, db.request)
    expect(
        db.calls.filter((call) => call.endpoint === 'git/ref/heads/rentner/release-media'),
    ).toHaveLength(2)
})

test('two concurrent writers preserve both contributor files without force pushes', async () => {
    const db = database()
    const other = { ...input, files: [{ name: 'contributor-bob.png', bytes: png }] }
    await Promise.all([
        publishReleaseMedia(input, db.request),
        publishReleaseMedia(other, db.request),
    ])
    const mutations = db.calls.filter((call) => call.method !== 'GET').length
    const alice = await publishReleaseMedia(input, db.request)
    const bob = await publishReleaseMedia(other, db.request)
    expect(alice.commitSha).toBe(bob.commitSha)
    expect(db.calls.filter((call) => call.method !== 'GET')).toHaveLength(mutations)
    expect(
        db.calls
            .filter((call) => call.method === 'PATCH')
            .every((call) => (call.body as { force: boolean }).force === false),
    ).toBe(true)
})

test('repeated races and unexpected Git tree data abort safely', async () => {
    const db = database()
    await expect(
        publishReleaseMedia(input, async (method, endpoint, body) => {
            if (endpoint === 'git/refs') return { status: 422, data: {} }
            return db.request(method, endpoint, body)
        }),
    ).rejects.toThrow('repeated concurrent updates')
    expect(
        db.calls.filter((call) => call.endpoint === 'git/ref/heads/rentner/release-media'),
    ).toHaveLength(4)
    const initialized = database()
    await publishReleaseMedia(input, initialized.request)
    const mutations = initialized.calls.filter((call) => call.method !== 'GET').length
    await expect(
        publishReleaseMedia(input, async (method, endpoint, body) => {
            if (endpoint.startsWith('git/trees/'))
                return {
                    status: 200,
                    data: {
                        truncated: false,
                        tree: [
                            {
                                path: '.github/workflows/run.yml',
                                mode: '100644',
                                type: 'blob',
                                sha: 'a'.repeat(40),
                            },
                        ],
                    },
                }
            return initialized.request(method, endpoint, body)
        }),
    ).rejects.toThrow('unexpected executable or non-media data')
    expect(initialized.calls.filter((call) => call.method !== 'GET')).toHaveLength(mutations)
})

test('update failure aborts without a URL result or release asset deletion', async () => {
    const db = database()
    db.failUpdate()
    await expect(publishReleaseMedia(input, db.request)).rejects.toThrow('HTTP 403')
    expect(db.calls.every((call) => call.endpoint.startsWith('git/'))).toBe(true)
})

test('rejects untrusted paths, repository, tag and PNG data before writes', async () => {
    const db = database()
    await Promise.all(
        [
            { ...input, repository: 'attacker/elsewhere' },
            { ...input, tagName: '../main' },
            { ...input, files: [{ name: '../workflow.yml', bytes: png }] },
            { ...input, files: [{ name: 'contributor-alice.png', bytes: new Uint8Array(45) }] },
            { ...input, files: [...input.files, ...input.files] },
        ].map(async (invalid) => {
            await expect(publishReleaseMedia(invalid, db.request)).rejects.toThrow()
        }),
    )
    expect(db.calls).toHaveLength(0)
    expect(() => repositoryMediaUrl(input.repository, 'main', 'test.png')).toThrow()
    expect(() => repositoryMediaUrl(input.repository, 'a'.repeat(40), '../test.png')).toThrow()
})

test('HTTP transport scopes auth to GitHub and never follows redirects', async () => {
    let requested = false
    const request = githubMediaRequest(input.repository, 'synthetic-token', async (url, init) => {
        requested = true
        expect(String(url)).toBe(
            'https://api.github.com/repos/RentnerProxy/platform/git/ref/heads/rentner/release-media',
        )
        expect(init?.redirect).toBe('error')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-token')
        return Response.json({}, { status: 404 })
    })
    expect(await request('GET', 'git/ref/heads/rentner/release-media')).toEqual({
        status: 404,
        data: {},
    })
    expect(requested).toBe(true)
})

test('HTTP transport bounds response bytes and rejects empty or invalid JSON data', async () => {
    for (const response of [
        new Response(null),
        new Response('invalid JSON'),
        new Response(new Uint8Array(8_388_609)),
    ]) {
        const request = githubMediaRequest(
            input.repository,
            'synthetic-token',
            async () => response,
        )
        // oxlint-disable-next-line no-await-in-loop -- Each fixture response is consumed exactly once.
        await expect(request('GET', 'git/ref/heads/rentner/release-media')).rejects.toThrow()
    }
})

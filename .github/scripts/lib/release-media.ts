/* oxlint-disable no-await-in-loop -- Git object creation and non-force retries depend on the preceding response. */
import { createHash } from 'node:crypto'
import { validateReleaseTag, deriveReleaseChannel, validateRepository } from './release-notes.ts'
import type {
    MediaRequest,
    PublishedReleaseMedia,
    ReleaseMediaInput,
} from './Types/release-media.types.ts'
import type { FetchImplementation } from '../release/Types/generate-release-notes.types.ts'
import { readBoundedStream } from '../../../web/src/lib/Http/readBoundedStream.ts'

const BRANCH = 'heads/rentner/release-media'

export function validateMediaRevision(revision: string): void {
    if (!/^[a-f0-9]{40}$/.test(revision))
        throw new Error('Release media revision must be a full commit SHA')
}

export function repositoryMediaUrl(repository: string, revision: string, path: string): string {
    validateRepository(repository)
    validateMediaRevision(revision)
    if (
        !/^[a-zA-Z0-9._/-]+$/.test(path) ||
        path.split('/').some((part) => !part || part === '.' || part === '..')
    )
        throw new Error('Invalid release media path')
    return `https://raw.githubusercontent.com/${repository}/${revision}/${path}`
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid Git media response')
    return value as Record<string, unknown>
}

function sha(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Missing Git media SHA')
    validateMediaRevision(value)
    return value
}

function validatePng(name: string, bytes: Uint8Array): void {
    const png = Buffer.from(bytes)
    if (
        !/^contributor-[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\.png$/.test(name) ||
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
        throw new Error('Release media must be a bounded 96x96 RGBA contributor PNG')
}

export function githubMediaRequest(
    repository: string,
    token: string,
    fetcher: FetchImplementation = fetch,
): MediaRequest {
    validateRepository(repository)
    if (!token.trim()) throw new Error('GITHUB_TOKEN is required')
    return async (method, endpoint, body) => {
        const signal = AbortSignal.timeout(30_000)
        const response = await fetcher(`https://api.github.com/repos/${repository}/${endpoint}`, {
            method,
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'User-Agent': 'RentnerProxy-release-media',
                'X-GitHub-Api-Version': '2022-11-28',
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal,
            redirect: 'error',
        })
        if (!response.body) throw new Error('Release media Git API returned an empty response')
        const bytes = await readBoundedStream(response.body, 8_388_608, signal)
        return {
            status: response.status,
            data: JSON.parse(new TextDecoder().decode(bytes)) as unknown,
        }
    }
}

export async function publishReleaseMedia(
    input: ReleaseMediaInput,
    request: MediaRequest,
): Promise<PublishedReleaseMedia> {
    validateRepository(input.repository)
    if (input.repository.toLowerCase() !== 'rentnerkev/rentnerproxy')
        throw new Error('Release media repository is not trusted')
    validateReleaseTag(input.tagName, deriveReleaseChannel(input.tagName) !== 'stable')
    if (input.files.length === 0 || input.files.length > 100)
        throw new Error('Release media requires 1 to 100 contributor images')
    const names = new Set<string>()
    let totalBytes = 0
    const files = input.files.map(({ name, bytes }) => {
        validatePng(name, bytes)
        if (names.has(name)) throw new Error('Duplicate release media filename')
        names.add(name)
        totalBytes += bytes.length
        const digest = createHash('sha256').update(bytes).digest('hex')
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
        return { name, bytes, blob, path: `releases/${input.tagName}/${digest}/${name}` }
    })
    if (totalBytes > 8_388_608) throw new Error('Release media exceeds aggregate size limit')
    const call = async (method: 'GET' | 'POST' | 'PATCH', endpoint: string, body?: unknown) => {
        const response = await request(method, endpoint, body)
        if (response.status < 200 || response.status >= 300)
            throw new Error(`Release media Git API ${method} failed with HTTP ${response.status}`)
        return record(response.data)
    }
    const result = (commitSha: string) => ({
        commitSha,
        urls: Object.fromEntries(
            files.map((file) => [
                file.name,
                repositoryMediaUrl(input.repository, commitSha, file.path),
            ]),
        ),
    })
    // A competing writer makes our child non-fast-forward. Reload its tree and retry without dropping its files.
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const ref = await request('GET', `git/ref/${BRANCH}`)
        if (ref.status !== 200 && ref.status !== 404)
            throw new Error(`Release media reference failed with HTTP ${ref.status}`)
        const parent = ref.status === 404 ? undefined : sha(record(record(ref.data).object).sha)
        let baseTree: string | undefined
        const existing = new Map<string, string>()
        if (parent) {
            const commit = await call('GET', `git/commits/${parent}`)
            baseTree = sha(record(commit.tree).sha)
            const tree = await call('GET', `git/trees/${baseTree}?recursive=1`)
            if (tree.truncated !== false || !Array.isArray(tree.tree))
                throw new Error('Release media tree is incomplete')
            for (const value of tree.tree) {
                const entry = record(value)
                if (entry.type === 'tree' && entry.mode === '040000') continue
                if (
                    entry.type !== 'blob' ||
                    entry.mode !== '100644' ||
                    typeof entry.path !== 'string' ||
                    !/^releases\/v[0-9A-Za-z.-]+\/[a-f0-9]{64}\/contributor-[a-z\d-]+\.png$/.test(
                        entry.path,
                    )
                )
                    throw new Error(
                        'Release media branch contains unexpected executable or non-media data',
                    )
                existing.set(entry.path, sha(entry.sha))
            }
            if (files.every((file) => existing.get(file.path) === file.blob)) return result(parent)
        }
        const entries = []
        for (const file of files) {
            if (existing.get(file.path) === file.blob) continue
            if (existing.has(file.path))
                throw new Error('Release media content-addressed path conflict')
            const blob = await call('POST', 'git/blobs', {
                content: Buffer.from(file.bytes).toString('base64'),
                encoding: 'base64',
            })
            if (sha(blob.sha) !== file.blob) throw new Error('Release media blob hash mismatch')
            entries.push({ path: file.path, mode: '100644', type: 'blob', sha: file.blob })
        }
        const tree = await call('POST', 'git/trees', {
            ...(baseTree ? { base_tree: baseTree } : {}),
            tree: entries,
        })
        const commit = await call('POST', 'git/commits', {
            message: `Release media for ${input.tagName}`,
            tree: sha(tree.sha),
            parents: parent ? [parent] : [],
        })
        const commitSha = sha(commit.sha)
        const update = parent
            ? await request('PATCH', `git/refs/${BRANCH}`, { sha: commitSha, force: false })
            : await request('POST', 'git/refs', { ref: `refs/${BRANCH}`, sha: commitSha })
        if (update.status >= 200 && update.status < 300) {
            if (sha(record(record(update.data).object).sha) !== commitSha)
                throw new Error('Release media reference update mismatch')
            return result(commitSha)
        }
        if (update.status !== 409 && update.status !== 422)
            throw new Error(`Release media reference update failed with HTTP ${update.status}`)
    }
    throw new Error('Release media publication lost repeated concurrent updates')
}

import { createHash } from 'node:crypto'
import type {
    RegistryFetch,
    RegistryPreflightInput,
    RegistryPreflightLimits,
} from './Types/registry-preflight.types.ts'

const versionTag = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u
const accept = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function request(
    url: string,
    headers: Record<string, string>,
    byteLimit: number,
    timeoutMs: number,
    fetcher: RegistryFetch,
) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const operation = async () => {
        const response = await fetcher(url, {
            method: 'GET',
            headers,
            redirect: 'error',
            signal: controller.signal,
        })
        const reader = response.body?.getReader()
        const cancel = () => {
            if (reader) void reader.cancel().catch(() => undefined)
        }
        controller.signal.addEventListener('abort', cancel, { once: true })
        if (controller.signal.aborted) cancel()
        const declared = response.headers.get('content-length')
        const chunks: Uint8Array[] = []
        let size = 0
        try {
            if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > byteLimit))
                throw new Error('Invalid registry response size')
            if (reader) {
                for (;;) {
                    // oxlint-disable-next-line no-await-in-loop -- Stream chunks must be consumed in order within the byte limit.
                    const { done, value } = await reader.read()
                    if (done) break
                    size += value.byteLength
                    if (size > byteLimit) throw new Error('Registry response exceeds limit')
                    chunks.push(value)
                }
            }
            const bytes = new Uint8Array(size)
            let offset = 0
            for (const chunk of chunks) {
                bytes.set(chunk, offset)
                offset += chunk.byteLength
            }
            return { status: response.status, bytes }
        } finally {
            controller.signal.removeEventListener('abort', cancel)
            cancel()
            try {
                reader?.releaseLock()
            } catch {
                // An abort may still be settling a pending read; never wait on cleanup.
            }
        }
    }
    try {
        return await Promise.race([
            operation(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort()
                    reject(new Error('Registry request timed out'))
                }, timeoutMs)
            }),
        ])
    } finally {
        clearTimeout(timer)
        controller.abort()
    }
}

export async function preflightVersionTags(
    input: RegistryPreflightInput,
    fetcher: RegistryFetch = fetch,
    limits: RegistryPreflightLimits = { timeoutMs: 10_000, manifestBytes: 8 * 1024 * 1024 },
): Promise<{ identicalTags: string[] }> {
    try {
        if (
            !/^ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/u.test(
                input.image,
            ) ||
            input.image.length > 255 ||
            !/^sha256:[a-f0-9]{64}$/u.test(input.expectedDigest) ||
            input.tags.length === 0 ||
            input.tags.length > 64 ||
            input.tags.some((tag) => tag.length > 128 || !versionTag.test(tag)) ||
            !input.username ||
            input.username.includes(':') ||
            !input.password
        )
            throw new Error('Invalid publication identity')
        const repository = input.image.slice('ghcr.io/'.length)
        const tokenUrl = new URL('https://ghcr.io/token')
        tokenUrl.searchParams.set('service', 'ghcr.io')
        tokenUrl.searchParams.set('scope', `repository:${repository}:pull`)
        const tokenResponse = await request(
            tokenUrl.href,
            {
                Authorization: `Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`,
            },
            64 * 1024,
            limits.timeoutMs,
            fetcher,
        )
        if (tokenResponse.status !== 200) throw new Error('Registry authentication failed')
        const token: unknown = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(tokenResponse.bytes),
        )
        if (
            !object(token) ||
            typeof token.token !== 'string' ||
            !token.token ||
            /[\r\n]/u.test(token.token)
        )
            throw new Error('Invalid registry token')
        const identicalTags: string[] = []
        for (const tag of new Set(input.tags)) {
            // oxlint-disable-next-line no-await-in-loop -- Bound registry concurrency and stop at the first rejected version.
            const manifest = await request(
                `https://ghcr.io/v2/${repository}/manifests/${tag}`,
                {
                    Authorization: `Bearer ${token.token}`,
                    Accept: accept,
                },
                limits.manifestBytes,
                limits.timeoutMs,
                fetcher,
            )
            if (manifest.status === 200) {
                const digest = 'sha256:' + createHash('sha256').update(manifest.bytes).digest('hex')
                if (digest !== input.expectedDigest) throw new Error('Immutable tag differs')
                identicalTags.push(tag)
            } else if (manifest.status === 404) {
                const failure: unknown = JSON.parse(
                    new TextDecoder('utf-8', { fatal: true }).decode(manifest.bytes),
                )
                if (
                    !object(failure) ||
                    !Array.isArray(failure.errors) ||
                    failure.errors.length === 0 ||
                    !failure.errors.every(
                        (error: unknown) =>
                            object(error) &&
                            (error.code === 'MANIFEST_UNKNOWN' || error.code === 'NAME_UNKNOWN'),
                    )
                )
                    throw new Error('Unconfirmed missing manifest')
            } else throw new Error('Cannot inspect immutable tag')
        }
        return { identicalTags }
    } catch {
        // Never expose registry bodies, transport errors, or authentication material.
        throw new Error('Immutable image preflight failed; no publication is permitted')
    }
}

if (import.meta.main) {
    try {
        const result = await preflightVersionTags({
            image: process.env.IMAGE ?? '',
            tags: (process.env.IMAGE_TAGS ?? '').split('\n').filter(Boolean),
            expectedDigest: process.env.EXPECTED_DIGEST ?? '',
            username: process.env.GHCR_USERNAME ?? '',
            password: process.env.GHCR_TOKEN ?? '',
        })
        console.log(JSON.stringify(result))
    } catch {
        console.error('Immutable image preflight failed; no publication is permitted')
        process.exitCode = 1
    }
}

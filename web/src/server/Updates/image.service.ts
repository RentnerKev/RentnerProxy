import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
    ApplicationUpdate,
    UpdateImageStatus,
} from '@/features/ApplicationVersion/Types/application-update.types.ts'
import type { ReleaseReadiness } from '@/lib/ApplicationVersion/Types/release-readiness.types.ts'
import { readBoundedBytes, readBoundedText, ResponseBodyLimitError } from './http.ts'

const repository = 'ghcr.io/rentnerkev/rentnerproxy'
const base = 'https://ghcr.io/v2/rentnerkev/rentnerproxy'
const digestPattern = /^sha256:[a-f0-9]{64}$/
const manifestTypes = [
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
]
const indexTypes = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
]
const descriptorSchema = z.object({
    mediaType: z.string(),
    digest: z.string().regex(digestPattern),
    size: z
        .number()
        .int()
        .nonnegative()
        .max(1024 * 1024),
    platform: z
        .object({ os: z.string(), architecture: z.string(), variant: z.string().optional() })
        .optional(),
})
const manifestSchema = z.object({
    schemaVersion: z.literal(2),
    mediaType: z.string(),
    config: descriptorSchema.optional(),
    manifests: z.array(descriptorSchema).max(100).optional(),
})
const configSchema = z.object({
    os: z.string(),
    architecture: z.string(),
    variant: z.string().optional(),
    config: z.object({ Labels: z.record(z.string(), z.string()) }),
})

class ImageCheckError extends Error {
    constructor(readonly status: UpdateImageStatus) {
        super('Image verification failed')
    }
}

function parseJson(bytes: Uint8Array): unknown {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        throw new ImageCheckError('invalid')
    }
}

function verifyDigest(bytes: Uint8Array, expected: string, response: Response): void {
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    const header = response.headers.get('docker-content-digest')
    if (actual !== expected || (header !== null && header !== expected))
        throw new ImageCheckError('invalid')
}

async function request(
    url: string,
    token: string | null,
    fetcher: typeof fetch,
    signal: AbortSignal,
    allowBlobRedirects = false,
): Promise<{ response: Response; signal: AbortSignal }> {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)])
    let target = new URL(url)
    for (let redirects = 0; redirects <= 3; redirects++) {
        requestSignal.throwIfAborted()
        // Each allowed redirect depends on the previous response's validated location.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetcher(target.href, {
            method: 'GET',
            redirect: 'manual',
            signal: requestSignal,
            headers: {
                Accept: [...indexTypes, ...manifestTypes, 'application/json'].join(', '),
                ...(target.hostname === 'ghcr.io' && token
                    ? { Authorization: `Bearer ${token}` }
                    : {}),
            },
        })
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location')
            void response.body?.cancel().catch(() => {})
            if (!allowBlobRedirects || !location || redirects === 3)
                throw new ImageCheckError('unavailable')
            const next = new URL(location, target)
            // GitHub documents this exact container-download host; do not trust arbitrary descriptor URLs.
            if (
                next.protocol !== 'https:' ||
                next.hostname !== 'pkg-containers.githubusercontent.com' ||
                next.port ||
                next.username ||
                next.password
            )
                throw new ImageCheckError('unavailable')
            target = next
            continue
        }
        if (!response.ok) {
            void response.body?.cancel().catch(() => {})
            throw new ImageCheckError(response.status === 404 ? 'pending' : 'unavailable')
        }
        return { response, signal: requestSignal }
    }
    throw new ImageCheckError('unavailable')
}

async function readVerified(
    url: string,
    digest: string,
    token: string,
    fetcher: typeof fetch,
    signal: AbortSignal,
    allowBlobRedirects = false,
    size?: number,
): Promise<unknown> {
    const result = await request(url, token, fetcher, signal, allowBlobRedirects)
    let bytes: Uint8Array
    try {
        bytes = await readBoundedBytes(result.response, 1024 * 1024, result.signal)
    } catch (error) {
        if (error instanceof ResponseBodyLimitError) throw new ImageCheckError('invalid')
        throw error
    }
    verifyDigest(bytes, digest, result.response)
    if (size !== undefined && bytes.byteLength !== size) throw new ImageCheckError('invalid')
    return parseJson(bytes)
}

export async function verifyReleaseImage(
    readiness: ReleaseReadiness,
    platform: string,
    fetcher: typeof fetch,
    signal: AbortSignal,
): Promise<ApplicationUpdate['image']> {
    const result = (status: UpdateImageStatus): ApplicationUpdate['image'] => ({
        status,
        reference:
            status === 'verified'
                ? `${repository}:${readiness.tag}@${readiness.image.digest}`
                : null,
        digest: status === 'verified' ? readiness.image.digest : null,
        platform,
    })
    if (
        readiness.image.repository !== repository ||
        !digestPattern.test(readiness.image.digest) ||
        !/^[\w][\w.-]{0,127}$/.test(readiness.tag)
    )
        return result('invalid')
    if (
        !/^[a-z0-9]+\/[a-z0-9]+(?:\/[a-z0-9]+)?$/.test(platform) ||
        !readiness.image.platforms.includes(platform)
    )
        return result('unsupported-platform')
    const overallSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)])
    try {
        const auth = await request(
            'https://ghcr.io/token?service=ghcr.io&scope=repository%3Arentnerkev%2Frentnerproxy%3Apull',
            null,
            fetcher,
            overallSignal,
        )
        const authData: unknown = JSON.parse(
            await readBoundedText(auth.response, 64 * 1024, auth.signal),
        )
        const parsedToken = z
            .object({
                token: z
                    .string()
                    .min(1)
                    .max(16384)
                    .regex(/^[A-Za-z0-9._~+/-]+=*$/),
            })
            .safeParse(authData)
        if (!parsedToken.success) return result('unavailable')
        const token = parsedToken.data.token
        let manifest = manifestSchema.safeParse(
            await readVerified(
                `${base}/manifests/${readiness.tag}`,
                readiness.image.digest,
                token,
                fetcher,
                overallSignal,
            ),
        )
        if (!manifest.success) return result('invalid')
        let selectedFromIndex = false
        if (indexTypes.includes(manifest.data.mediaType)) {
            if (!manifest.data.manifests) return result('invalid')
            const candidates = manifest.data.manifests.filter((item) => {
                if (!item.platform || !manifestTypes.includes(item.mediaType)) return false
                const itemPlatform = [
                    item.platform.os,
                    item.platform.architecture,
                    ...(item.platform.variant ? [item.platform.variant] : []),
                ].join('/')
                return itemPlatform === platform
            })
            if (candidates.length === 0) return result('unsupported-platform')
            if (candidates.length !== 1) return result('invalid')
            const descriptor = candidates[0]!
            manifest = manifestSchema.safeParse(
                await readVerified(
                    `${base}/manifests/${descriptor.digest}`,
                    descriptor.digest,
                    token,
                    fetcher,
                    overallSignal,
                    false,
                    descriptor.size,
                ),
            )
            if (!manifest.success) return result('invalid')
            selectedFromIndex = true
        }
        if (!manifestTypes.includes(manifest.data.mediaType) || !manifest.data.config)
            return result('invalid')
        const descriptor = manifest.data.config
        if (
            ![
                'application/vnd.oci.image.config.v1+json',
                'application/vnd.docker.container.image.v1+json',
            ].includes(descriptor.mediaType)
        )
            return result('invalid')
        const config = configSchema.safeParse(
            await readVerified(
                `${base}/blobs/${descriptor.digest}`,
                descriptor.digest,
                token,
                fetcher,
                overallSignal,
                true,
                descriptor.size,
            ),
        )
        if (!config.success) return result('invalid')
        const configPlatform = [
            config.data.os,
            config.data.architecture,
            ...(config.data.variant ? [config.data.variant] : []),
        ].join('/')
        if (configPlatform !== platform)
            return result(selectedFromIndex ? 'invalid' : 'unsupported-platform')
        const labels = config.data.config.Labels
        if (
            labels['org.opencontainers.image.source'] !==
                'https://github.com/RentnerKev/RentnerProxy' ||
            labels['org.opencontainers.image.version'] !== readiness.tag ||
            labels['org.opencontainers.image.revision'] !== readiness.revision
        )
            return result('invalid')
        return result('verified')
    } catch (error) {
        return result(error instanceof ImageCheckError ? error.status : 'unavailable')
    }
}

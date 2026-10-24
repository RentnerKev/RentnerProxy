import type { DownloadFetch, GeoipAsset } from './Types/download-geoip.types.ts'
// oxlint-disable no-await-in-loop -- Read bounded streams and retry upstream publication transitions in order.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const repositoryApi = 'https://api.github.com/repos/sapics/ip-location-db'
const metadataUrl = repositoryApi + '/releases/tags/latest'
const maximumDatabaseBytes = 64 * 1024 * 1024

class PublicationTransition extends Error {}

async function readBounded(
    response: Response,
    label: string,
    minimum: number,
    maximum: number,
): Promise<Uint8Array> {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('GeoIP ' + label + ' body is missing')
    try {
        const lengthHeader = response.headers.get('Content-Length')
        const expectedLength = lengthHeader === null ? undefined : Number(lengthHeader)
        if (
            lengthHeader !== null &&
            (!/^[0-9]+$/u.test(lengthHeader) ||
                !Number.isSafeInteger(expectedLength) ||
                expectedLength! < minimum ||
                expectedLength! > maximum)
        )
            throw new Error('GeoIP ' + label + ' size is invalid')
        const chunks: Uint8Array[] = []
        let length = 0
        while (true) {
            const result = await reader.read()
            if (result.done) break
            length += result.value.byteLength
            if (length > maximum) throw new Error('GeoIP ' + label + ' exceeds size limit')
            chunks.push(result.value)
        }
        if (length < minimum || (expectedLength !== undefined && length !== expectedLength))
            throw new Error('GeoIP ' + label + ' size mismatch')
        const bytes = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
        }
        return bytes
    } finally {
        await reader.cancel().catch(() => undefined)
        reader.releaseLock()
    }
}

async function fetchBytes(
    fetchAsset: DownloadFetch,
    url: string,
    label: string,
    minimum: number,
    maximum: number,
    accept = 'application/octet-stream',
): Promise<Uint8Array> {
    const response = await fetchAsset(url, {
        // Keep Content-Length comparable to streamed bytes when fetch decodes responses.
        headers: { Accept: accept, 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        const message = 'GeoIP ' + label + ' download failed (HTTP ' + response.status + ')'
        if (response.status === 404) throw new PublicationTransition(message)
        throw new Error(message)
    }
    return readBounded(response, label, minimum, maximum)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

async function latestAsset(fetchAsset: DownloadFetch): Promise<GeoipAsset> {
    const bytes = await fetchBytes(
        fetchAsset,
        metadataUrl,
        'metadata',
        1,
        1024 * 1024,
        'application/vnd.github+json',
    )
    let release: unknown
    try {
        release = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        throw new Error('GeoIP metadata JSON is invalid')
    }
    if (
        !isRecord(release) ||
        !isPositiveId(release.id) ||
        release.url !== repositoryApi + '/releases/' + release.id ||
        release.html_url !== 'https://github.com/sapics/ip-location-db/releases/tag/latest' ||
        release.tag_name !== 'latest' ||
        release.draft !== false ||
        !Array.isArray(release.assets)
    )
        throw new Error('GeoIP release metadata is invalid')
    const matches = release.assets.filter(
        (asset: unknown) => isRecord(asset) && asset.name === 'user-country.mmdb',
    )
    const asset: unknown = matches[0]
    if (
        matches.length !== 1 ||
        !isRecord(asset) ||
        !isPositiveId(asset.id) ||
        asset.url !== repositoryApi + '/releases/assets/' + asset.id ||
        asset.browser_download_url !==
            'https://github.com/sapics/ip-location-db/releases/download/latest/user-country.mmdb' ||
        asset.state !== 'uploaded' ||
        typeof asset.size !== 'number' ||
        !Number.isSafeInteger(asset.size) ||
        asset.size < 1 ||
        asset.size > maximumDatabaseBytes ||
        typeof asset.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(asset.digest)
    )
        throw new Error('GeoIP asset metadata is invalid')
    return { id: asset.id, size: asset.size, digest: asset.digest, url: asset.url }
}

export async function downloadGeoip(fetchAsset: DownloadFetch = fetch): Promise<ArrayBuffer> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const before = await latestAsset(fetchAsset)
            const bytes = await fetchBytes(fetchAsset, before.url, 'asset', 1, before.size)
            if (bytes.byteLength !== before.size) throw new Error('GeoIP asset size mismatch')
            if (createHash('sha256').update(bytes).digest('hex') !== before.digest.slice(7))
                throw new Error('GeoIP asset checksum mismatch')
            const after = await latestAsset(fetchAsset)
            if (
                before.id !== after.id ||
                before.digest !== after.digest ||
                before.size !== after.size
            )
                throw new PublicationTransition('GeoIP asset changed during download')
            return bytes.buffer as ArrayBuffer
        } catch (error) {
            if (!(error instanceof PublicationTransition) || attempt === 1) throw error
        }
    }
    throw new Error('GeoIP asset download failed')
}

if (import.meta.main) {
    const bytes = await downloadGeoip()
    await writeFile('/tmp/user-country.mmdb', new Uint8Array(bytes))
    console.log('GeoIP database SHA-256 verified')
}

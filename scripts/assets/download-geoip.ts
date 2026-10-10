import type { DownloadFetch } from './Types/download-geoip.types.ts'
// oxlint-disable no-await-in-loop -- Read bounded streams and retry upstream publication transitions in order.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const releaseDownloads = 'https://github.com/sapics/ip-location-db/releases/download/'
const checksumUrl = releaseDownloads + 'checksum/user-country.mmdb.sha256'
const databaseUrl = releaseDownloads + 'latest/user-country.mmdb'
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
): Promise<Uint8Array> {
    const response = await fetchAsset(url, {
        headers: { Accept: 'application/octet-stream', 'Cache-Control': 'no-cache' },
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

async function checksum(fetchAsset: DownloadFetch): Promise<string> {
    const bytes = await fetchBytes(fetchAsset, checksumUrl, 'checksum', 84, 84)
    const value = new TextDecoder().decode(bytes)
    if (!/^[a-f0-9]{64}  user-country\.mmdb\n$/u.test(value))
        throw new Error('GeoIP checksum format is invalid')
    return value
}

export async function downloadGeoip(fetchAsset: DownloadFetch = fetch): Promise<ArrayBuffer> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const before = await checksum(fetchAsset)
            const bytes = await fetchBytes(
                fetchAsset,
                databaseUrl,
                'asset',
                1,
                maximumDatabaseBytes,
            )
            const after = await checksum(fetchAsset)
            if (before !== after)
                throw new PublicationTransition('GeoIP checksum changed during download')
            if (createHash('sha256').update(bytes).digest('hex') !== before.slice(0, 64))
                throw new PublicationTransition('GeoIP asset checksum mismatch')
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

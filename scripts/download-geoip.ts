import type { DownloadFetch, ReleaseAsset } from './Types/download-geoip.types.ts'
// oxlint-disable no-await-in-loop -- A replaced release asset needs a fresh metadata snapshot before retrying.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const repositoryApi = 'https://api.github.com/repos/sapics/ip-location-db'
const maximumDatabaseBytes = 64 * 1024 * 1024

export async function downloadGeoip(fetchAsset: DownloadFetch = fetch): Promise<ArrayBuffer> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const metadata = await fetchAsset(repositoryApi + '/releases/tags/latest', {
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(60_000),
        })
        if (!metadata.ok)
            throw new Error('GeoIP metadata download failed (HTTP ' + metadata.status + ')')
        const release = (await metadata.json()) as { assets?: ReleaseAsset[] }
        const asset = Array.isArray(release.assets)
            ? release.assets.find((candidate) => candidate.name === 'user-country.mmdb')
            : undefined
        if (
            !asset ||
            !Number.isSafeInteger(asset.id) ||
            asset.id <= 0 ||
            asset.state !== 'uploaded' ||
            !Number.isSafeInteger(asset.size) ||
            asset.size <= 0 ||
            asset.size > maximumDatabaseBytes ||
            typeof asset.digest !== 'string' ||
            !/^sha256:[a-f0-9]{64}$/u.test(asset.digest)
        )
            throw new Error('GeoIP release asset metadata is invalid')

        // Bind the bytes and digest to the same asset, even when the latest tag is updated.
        const response = await fetchAsset(repositoryApi + '/releases/assets/' + asset.id, {
            headers: { Accept: 'application/octet-stream' },
            signal: AbortSignal.timeout(60_000),
        })
        if (response.status === 404 && attempt === 0) continue
        if (!response.ok)
            throw new Error('GeoIP asset download failed (HTTP ' + response.status + ')')
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength !== asset.size) throw new Error('GeoIP asset size mismatch')
        if (
            'sha256:' + createHash('sha256').update(new Uint8Array(bytes)).digest('hex') !==
            asset.digest
        )
            throw new Error('GeoIP asset checksum mismatch')
        return bytes
    }
    throw new Error('GeoIP asset download failed')
}

if (import.meta.main) {
    const bytes = await downloadGeoip()
    await writeFile('/tmp/user-country.mmdb', new Uint8Array(bytes))
    console.log('GeoIP database SHA-256 verified')
}

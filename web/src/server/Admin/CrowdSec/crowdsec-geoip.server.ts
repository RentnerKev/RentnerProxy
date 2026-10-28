import type { GeoReader } from './Types/crowdsec-geoip.types.ts'
import '@tanstack/react-start/server-only'

import { open } from 'node:fs/promises'
import { isIP } from 'node:net'
import { isAbsolute, join } from 'node:path'

import { Reader } from 'mmdb-lib'

import countryCodeFromGeoRecord from '@/lib/Admin/CrowdSec/countryCodeFromGeoRecord.ts'
import type { CrowdSecDashboard } from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'

const maximumDatabaseBytes = 64 * 1024 * 1024
const maximumCacheEntries = 10_000

function createCache() {
    const entries = new Map<string | number, unknown>()
    return {
        get(key: string | number): unknown {
            if (!entries.has(key)) return undefined
            const value = entries.get(key)
            entries.delete(key)
            entries.set(key, value)
            return value
        },
        set(key: string | number, value: unknown): void {
            entries.delete(key)
            entries.set(key, value)
            if (entries.size > maximumCacheEntries) {
                const oldest = entries.keys().next()
                if (!oldest.done) entries.delete(oldest.value)
            }
        },
    }
}

function databasePath(): string {
    const configured = process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH?.trim()
    if (configured && isAbsolute(configured)) return configured
    return process.env.NODE_ENV === 'production'
        ? '/usr/share/rentnerproxy/geoip/user-country.mmdb'
        : join(process.cwd(), '.local', 'geoip', 'user-country.mmdb')
}

async function loadReader(path: string): Promise<GeoReader> {
    const file = await open(path, 'r')
    try {
        const metadata = await file.stat()
        const { size } = metadata
        if (!metadata.isFile() || size < 1 || size > maximumDatabaseBytes) {
            throw new Error('GeoIP database size is invalid')
        }
        const bytes = Buffer.alloc(size + 1)
        let length = 0
        while (length < bytes.length) {
            // oxlint-disable-next-line no-await-in-loop -- Read partial chunks within the fixed allocation.
            const { bytesRead } = await file.read(bytes, length, bytes.length - length, length)
            if (bytesRead === 0) break
            length += bytesRead
        }
        if (length !== size) throw new Error('GeoIP database size changed while reading')
        return new Reader(bytes.subarray(0, length), { cache: createCache() })
    } finally {
        await file.close()
    }
}

export function createGeoReader(
    path: () => string = databasePath,
): () => Promise<GeoReader | null> {
    let readerPromise: Promise<GeoReader | null> | undefined
    return (): Promise<GeoReader | null> => {
        readerPromise ??= loadReader(path()).catch(() => {
            readerPromise = undefined
            return null
        })
        return readerPromise
    }
}

const reader = createGeoReader()

export async function enrichCrowdSecCountryCodes(
    dashboard: CrowdSecDashboard,
): Promise<CrowdSecDashboard> {
    const decisions = dashboard.decisions
    if (!decisions?.entries.some((entry) => entry.scope === 'Ip' && !entry.countryCode)) {
        return dashboard
    }
    const lookup = await reader()
    if (!lookup) return dashboard
    return {
        ...dashboard,
        decisions: {
            ...decisions,
            entries: decisions.entries.map((entry) => {
                if (entry.scope !== 'Ip' || entry.countryCode || !isIP(entry.value)) return entry
                try {
                    const countryCode = countryCodeFromGeoRecord(lookup.get(entry.value))
                    return countryCode ? Object.assign({}, entry, { countryCode }) : entry
                } catch {
                    return entry
                }
            }),
        },
    }
}

import '@tanstack/react-start/server-only'

import { isIP } from 'node:net'
import { isAbsolute, join } from 'node:path'

import maxmind from 'maxmind'

import countryCodeFromGeoRecord from '../../../features/Admin/CrowdSec/Helpers/countryCodeFromGeoRecord'
import type { CrowdSecDashboard } from '../../../shared/Types/crowdsec.types'

type GeoReader = Awaited<ReturnType<typeof maxmind.open>>

let readerPromise: Promise<GeoReader | null> | undefined

function databasePath(): string {
    const configured = process.env.RENTNERPROXY_GEOIP_COUNTRY_DB_PATH?.trim()
    if (configured && isAbsolute(configured)) return configured
    return process.env.NODE_ENV === 'production'
        ? '/usr/share/rentnerproxy/geoip/user-country.mmdb'
        : join(process.cwd(), '.local', 'geoip', 'user-country.mmdb')
}

async function reader(): Promise<GeoReader | null> {
    if (!readerPromise) {
        readerPromise = maxmind.open(databasePath()).catch(() => {
            readerPromise = undefined
            return null
        })
    }
    return readerPromise
}

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

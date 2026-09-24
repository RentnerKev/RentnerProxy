import { SQL } from 'bun'

import { CROWDSEC_DASHBOARD_DEMO_KEY } from '../web/src/config/crowdsec.config'
import type { CrowdSecDashboard, CrowdSecDecision } from '../web/src/shared/Types/crowdsec.types'

function isLoopback(value: string | undefined): boolean {
    if (!value) return false
    try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)
    } catch {
        return false
    }
}

function createDemoDecisions(): CrowdSecDecision[] {
    const origins = ['crowdsec', 'CAPI', 'cscli'] as const
    const scenarios = [
        'crowdsecurity/http-probing',
        'crowdsecurity/http-sensitive-files',
        'crowdsecurity/http-admin-interface-probing',
        'crowdsecurity/http-wordpress-scan',
        'crowdsecurity/http-generic-bf',
    ] as const
    const countries = ['DE', 'US', 'FR', 'GB', 'NL', 'CA'] as const
    return Array.from({ length: 32 }, (_, index) => ({
        id: 9_000 + index,
        scope: index % 9 === 0 ? 'Range' : 'Ip',
        value:
            index % 9 === 0
                ? `198.51.100.${Math.floor(index / 9) * 16}/28`
                : `203.0.113.${index + 1}`,
        origin: origins[index % origins.length] ?? 'crowdsec',
        scenario: scenarios[index % scenarios.length] ?? 'crowdsecurity/http-probing',
        duration: `${1 + (index % 8)}h${(index * 7) % 60}m`,
        countryCode: index % 9 === 0 ? null : (countries[index % countries.length] ?? null),
    }))
}

export function createCrowdSecDemoDashboard(): CrowdSecDashboard {
    const entries = createDemoDecisions()
    const decisionsByOrigin = ['crowdsec', 'CAPI', 'cscli'].map((origin) => ({
        origin,
        count: entries.filter((entry) => entry.origin === origin).length,
    }))
    return {
        collectedAt: Math.floor(Date.now() / 1_000),
        metrics: {
            blockedRequests: 0,
            activeDecisions: entries.length,
            blockedByOrigin: [],
            decisionsByOrigin,
        },
        decisions: {
            total: entries.length,
            filteredTotal: entries.length,
            offset: 0,
            limit: 15,
            availableOrigins: ['CAPI', 'crowdsec', 'cscli'],
            entries,
        },
    }
}

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL
    if (
        process.env.NODE_ENV === 'production' ||
        !isLoopback(process.env.APP_URL) ||
        !isLoopback(databaseUrl) ||
        !databaseUrl
    ) {
        throw new Error('Demo data may only be seeded into a loopback development database.')
    }
    const database = new SQL(databaseUrl)
    try {
        await database.unsafe(
            'insert into rentnerproxy.system_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value',
            [CROWDSEC_DASHBOARD_DEMO_KEY, JSON.stringify(createCrowdSecDemoDashboard())],
        )
        console.log('Seeded 32 synthetic CrowdSec decisions in the local development database.')
    } finally {
        await database.close()
    }
}

if (import.meta.main) await main()

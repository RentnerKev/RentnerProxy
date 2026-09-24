import type {
    CrowdSecDashboard,
    CrowdSecDashboardQuery,
} from '../../../../shared/Types/crowdsec.types'

function isLoopbackUrl(value: string | undefined): boolean {
    if (!value) return false
    try {
        return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname)
    } catch {
        return false
    }
}

export function isLocalCrowdSecDemoEnvironment(environment: NodeJS.ProcessEnv): boolean {
    return (
        environment.NODE_ENV === 'development' &&
        isLoopbackUrl(environment.APP_URL) &&
        isLoopbackUrl(environment.DATABASE_URL)
    )
}

export function filterCrowdSecDemoDashboard(
    source: CrowdSecDashboard,
    query: CrowdSecDashboardQuery,
): CrowdSecDashboard {
    const decisions = source.decisions
    if (!decisions) return { ...source, demo: true, collectedAt: Math.floor(Date.now() / 1_000) }
    const search = query.search.trim().toLowerCase()
    const matches = decisions.entries.filter(
        (entry) =>
            (!query.origin || entry.origin.toLowerCase() === query.origin.toLowerCase()) &&
            (!query.scope || entry.scope === query.scope) &&
            (!search ||
                entry.value.toLowerCase().includes(search) ||
                entry.origin.toLowerCase().includes(search) ||
                entry.scenario.toLowerCase().includes(search)),
    )
    return {
        ...source,
        demo: true,
        collectedAt: Math.floor(Date.now() / 1_000),
        decisions: {
            ...decisions,
            total: decisions.entries.length,
            filteredTotal: matches.length,
            offset: query.offset,
            limit: query.limit,
            entries: matches.slice(query.offset, query.offset + query.limit),
        },
    }
}

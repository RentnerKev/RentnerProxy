import type { CrowdSecDashboard, CrowdSecDashboardQuery } from './Types/crowdsec.types.ts'

export default function filterCrowdSecDashboard(
    source: CrowdSecDashboard,
    query: CrowdSecDashboardQuery,
): CrowdSecDashboard {
    const decisions = source.decisions
    if (!decisions) return source
    const search = query.search.trim().toLowerCase()
    const matches = decisions.entries.filter(
        (entry) =>
            (!query.origin || entry.origin.toLowerCase() === query.origin.toLowerCase()) &&
            (!query.scope || entry.scope === query.scope) &&
            (!query.country || entry.countryCode === query.country) &&
            (!search ||
                entry.value.toLowerCase().includes(search) ||
                entry.origin.toLowerCase().includes(search) ||
                entry.scenario.toLowerCase().includes(search)),
    )
    return {
        ...source,
        decisions: {
            ...decisions,
            filteredTotal: matches.length,
            offset: query.offset,
            limit: query.limit,
            entries: matches.slice(query.offset, query.offset + query.limit),
        },
    }
}

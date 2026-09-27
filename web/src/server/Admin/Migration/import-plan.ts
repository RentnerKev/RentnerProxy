import type { NpmImportPlan, NpmImportPlanItem } from '../NpmImport/npm-plan'

export function finalizeImportPlan(
    fingerprint: string,
    sourceSchema: string,
    items: readonly NpmImportPlanItem[],
    existingDomains: ReadonlyMap<string, string>,
): NpmImportPlan {
    const hosts = items.filter(
        (item) => item.kind === 'proxy-host' || item.kind === 'redirect-host',
    )
    const sourceCounts = new Map<string, number>()
    for (const host of hosts) {
        for (const domain of host.domains) {
            sourceCounts.set(domain, (sourceCounts.get(domain) ?? 0) + 1)
        }
    }
    const checked = items.map((item): NpmImportPlanItem => {
        if (item.kind !== 'proxy-host' && item.kind !== 'redirect-host') return item
        if (item.domains.some((domain) => (sourceCounts.get(domain) ?? 0) > 1)) {
            return { ...item, status: 'conflict', reasons: ['source_duplicate_domain'] }
        }
        const existing = item.domains.find((domain) => existingDomains.has(domain))
        return existing
            ? {
                  ...item,
                  status: 'conflict',
                  reasons: [`existing_domain:${existingDomains.get(existing)}`],
              }
            : item
    })
    return {
        fingerprint,
        sourceSchema,
        items: checked,
    }
}

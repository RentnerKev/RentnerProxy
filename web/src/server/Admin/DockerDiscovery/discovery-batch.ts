// oxlint-disable no-await-in-loop -- Attempts must remain serialized within one bounded transaction.
import type { DiscoveryRegistry } from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { DiscoveryPlan } from './Types/discovery-plan.types.ts'

/** Advances after the last actual attempt and retains errors for all unattempted candidates. */
export async function runDiscoveryBatch(
    changes: DiscoveryPlan['changes'],
    previous: DiscoveryRegistry['results'],
    afterKey: string | null,
    attempt: (
        change: DiscoveryPlan['changes'][number],
    ) => Promise<DiscoveryRegistry['results'][number]['error'] | null>,
    now: () => number = Date.now,
) {
    const sorted = changes.toSorted((a, b) => a.key.localeCompare(b.key))
    const next = afterKey === null ? 0 : sorted.findIndex((change) => change.key > afterKey)
    const start = next < 0 ? 0 : next
    const batch = [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, 16)
    const results = new Map(previous.map((result) => [result.key, result]))
    const deadline = now() + 10_000
    let cursor = afterKey
    for (const change of batch) {
        if (now() >= deadline) break
        const error = await attempt(change)
        cursor = change.key
        if (error) results.set(change.key, { key: change.key, error })
        else results.delete(change.key)
    }
    return {
        afterKey: cursor,
        results: [...results.values()].toSorted((a, b) => a.key.localeCompare(b.key)),
    }
}

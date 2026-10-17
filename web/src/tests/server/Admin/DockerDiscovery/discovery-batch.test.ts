// oxlint-disable no-await-in-loop -- Each simulated cycle consumes the previous cycle's cursor and results.
import { expect, test } from 'bun:test'
import { runDiscoveryBatch } from '@/server/Admin/DockerDiscovery/discovery-batch.ts'
import { createDiscoveryPlan } from '@/server/Admin/DockerDiscovery/discovery-plan.ts'
import {
    discoveryCandidate,
    discoverySnapshot,
    discoveryRegistry,
} from '@/tests/Helpers/discoveryFixture.ts'
import type { DiscoveryRegistry } from '@/lib/DockerDiscovery/Types/management.types.ts'

function changes(count: number) {
    return createDiscoveryPlan(
        discoverySnapshot(
            Array.from({ length: count }, (_, index) =>
                discoveryCandidate({
                    containerId: index.toString(16).padStart(64, '0'),
                    sourceId: `name:app-${index}`,
                    domains: [`app-${index}.example.com`],
                }),
            ),
        ),
        discoveryRegistry(),
        { hosts: [], domains: [] },
    ).changes
}
test('slow failures exhaust the deadline without starving any of more than sixteen candidates', async () => {
    const plan = changes(32)
    const attempted = new Set<string>()
    let afterKey: string | null = null
    let results: DiscoveryRegistry['results'] = []
    let time = 0
    for (let cycle = 0; cycle < 16; cycle++) {
        const result = await runDiscoveryBatch(
            plan,
            results,
            afterKey,
            async (change) => {
                attempted.add(change.key)
                time += 6000
                return 'reference_invalid'
            },
            () => time,
        )
        afterKey = result.afterKey
        results = result.results
    }
    expect(attempted.size).toBe(32)
    expect(results).toHaveLength(32)
})
test('untouched candidate errors remain visible across different bounded batches', async () => {
    const plan = changes(40)
    const original: DiscoveryRegistry['results'] = plan.map((change) => ({
        key: change.key,
        error: 'reference_invalid',
    }))
    const firstAttempted = new Set<string>()
    const first = await runDiscoveryBatch(plan, original, null, async (change) => {
        firstAttempted.add(change.key)
        return null
    })
    expect(firstAttempted.size).toBe(16)
    expect(first.results).toHaveLength(24)
    expect(first.results.every((result) => !firstAttempted.has(result.key))).toBe(true)
    const second = await runDiscoveryBatch(
        plan,
        first.results,
        first.afterKey,
        async () => 'authorization_required',
    )
    expect(second.results).toHaveLength(24)
    expect(
        second.results.filter((result) => result.error === 'authorization_required'),
    ).toHaveLength(16)
    expect(second.results.filter((result) => result.error === 'reference_invalid')).toHaveLength(8)
})
test('a source-key cursor remains fair when successful candidates leave the plan', async () => {
    let plan = changes(48)
    const visited = new Set<string>()
    let afterKey: string | null = null
    while (plan.length) {
        let time = 0
        const result = await runDiscoveryBatch(
            plan,
            [],
            afterKey,
            async (change) => {
                visited.add(change.key)
                time += 6000
                return null
            },
            () => time,
        )
        afterKey = result.afterKey
        plan = plan.filter((change) => !visited.has(change.key))
    }
    expect(visited.size).toBe(48)
})

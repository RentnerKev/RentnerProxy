import assert from 'node:assert/strict'
import type { ReliabilityContext } from '../runtime-reliability/Types/harness.types.ts'
import { runBoundedTasks } from './control.ts'
import type { ScaleResult } from './Types/control.types.ts'

export async function verifyConcurrentTraffic(
    context: Pick<ReliabilityContext, 'http' | 'recordTrafficFailure'>,
    traffic: ScaleResult['traffic'],
    concurrency: number,
) {
    const routes = traffic
        .map((expected, index) => ({ expected, index }))
        .filter(({ expected }) => expected.backend)
        .slice(0, 32)
    await runBoundedTasks(routes, concurrency, async ({ expected, index }) => {
        const response = await context.http(expected.domain, '/', {}, index)
        try {
            assert.ok(
                response.status === 200 || response.status === 404,
                'Concurrent traffic stays within old/new route states',
            )
            if (response.status === 200)
                assert.ok(
                    ['a', 'b', 'tls'].includes(response.body.backend),
                    'Concurrent traffic reaches an owned upstream',
                )
        } catch (error) {
            context.recordTrafficFailure(index, response.status)
            throw error
        }
    })
}

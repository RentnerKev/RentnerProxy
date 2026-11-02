import { hostFetchCode } from '../../../../scripts/runtime-reliability/transport-diagnostics.ts'

import type { Beta2Action, Beta2Diagnostic } from './Types/diagnostics.types.ts'

/** Emits only fixture stage names and allowlisted transport codes, never raw error payloads. */
export function createBeta2RoundDiagnostics(
    round: number,
    report: (event: Beta2Diagnostic) => void = (event) =>
        console.error('Beta 2 diagnostic', JSON.stringify(event)),
) {
    const started = performance.now()
    const active = new Set<Beta2Action>()
    function emit(
        event: Beta2Diagnostic['event'],
        extra: Pick<Beta2Diagnostic, 'stage' | 'domain' | 'errorCode'> = {},
    ) {
        try {
            report({
                round,
                event,
                elapsedMs: Math.round(performance.now() - started),
                activeStages: [...active],
                ...extra,
            })
        } catch {
            /* Diagnostics must not replace the original workload failure. */
        }
    }
    return {
        async span<T>(stage: Beta2Action, operation: () => Promise<T>): Promise<T> {
            active.add(stage)
            emit('action-start', { stage })
            try {
                const result = await operation()
                emit('action-complete', { stage })
                return result
            } catch (error) {
                emit('action-failure', { stage, errorCode: hostFetchCode(error) })
                throw error
            } finally {
                active.delete(stage)
            }
        },
        transportFailure(domain: string, error: unknown) {
            emit('transport-failure', {
                domain: /^(?:h\d{1,3}|discovered)\.beta2\.test$/u.test(domain)
                    ? domain
                    : 'fixture-route',
                errorCode: hostFetchCode(error),
            })
        },
    }
}

/** Drains every sibling so all named action failures are reported before propagating traffic failure. */
export async function drainBeta2Round(
    actions: Promise<PromiseSettledResult<unknown>[]>,
    traffic: Promise<void>,
): Promise<void> {
    const [actionResults, trafficResult] = await Promise.allSettled([actions, traffic])
    if (trafficResult.status === 'rejected') throw trafficResult.reason
    if (actionResults.status === 'rejected') throw actionResults.reason
    for (const result of actionResults.value) if (result.status === 'rejected') throw result.reason
}

import { describe, expect, test } from 'bun:test'
import {
    createBeta2RoundDiagnostics,
    drainBeta2Round,
} from '../../../../../.github/scripts/ci/beta2/diagnostics.ts'
import type { Beta2Diagnostic } from '../../../../../.github/scripts/ci/beta2/Types/diagnostics.types.ts'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept
        reject = fail
    })
    return { promise, resolve, reject }
}

describe('Beta 2 round diagnostics and failure ownership', () => {
    test('reports an immediate reset with all active stages and no raw input or error payload', async () => {
        const events: Beta2Diagnostic[] = []
        const diagnostics = createBeta2RoundDiagnostics(2, (event) => events.push(event))
        const ddns = deferred<void>()
        const updates = deferred<void>()
        const actions = Promise.allSettled([
            diagnostics.span('ddns', () => ddns.promise),
            diagnostics.span('updates', () => updates.promise),
        ])
        const reset = Object.assign(new Error('https://private.example/?token=secret'), {
            code: 'ECONNRESET',
        })
        diagnostics.transportFailure('h17.beta2.test', reset)
        expect(events.at(-1)).toMatchObject({
            round: 2,
            event: 'transport-failure',
            domain: 'h17.beta2.test',
            errorCode: 'ECONNRESET',
            activeStages: ['ddns', 'updates'],
        })
        diagnostics.transportFailure(
            'https://private.example/?token=secret',
            Object.assign(new Error('secret'), { code: 'secret' }),
        )
        expect(events.at(-1)).toMatchObject({ domain: 'fixture-route', errorCode: 'unexpected' })
        expect(JSON.stringify(events)).not.toContain('secret')
        expect(JSON.stringify(events)).not.toContain('https:')
        ddns.resolve()
        updates.resolve()
        await actions
        diagnostics.transportFailure('discovered.beta2.test', reset)
        expect(events.at(-1)?.activeStages).toEqual([])
    })

    test('reports every rejected action and drains in-flight siblings before rethrowing the same traffic error', async () => {
        const events: Beta2Diagnostic[] = []
        const diagnostics = createBeta2RoundDiagnostics(1, (event) => events.push(event))
        const ddns = deferred<void>()
        const recreate = deferred<void>()
        const updates = deferred<void>()
        const actions = Promise.allSettled([
            diagnostics.span('ddns', () => ddns.promise),
            diagnostics.span('recreate', () => recreate.promise),
            diagnostics.span('updates', () => updates.promise),
        ])
        const reset = Object.assign(new Error('raw token'), { code: 'ECONNRESET' })
        const traffic = deferred<void>()
        let settled = false
        const outcome = drainBeta2Round(actions, traffic.promise).then(
            () => {
                settled = true
                return undefined
            },
            (error: unknown) => {
                settled = true
                return error
            },
        )
        traffic.reject(reset)
        ddns.reject(new Error('raw DDNS credential'))
        recreate.reject(new Error('raw inventory URL'))
        await Promise.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)
        expect(
            events.filter((event) => event.event === 'action-failure').map((event) => event.stage),
        ).toEqual(['ddns', 'recreate'])
        updates.resolve()
        expect(await outcome).toBe(reset)
        expect(
            events.filter((event) => event.event === 'action-complete').map((event) => event.stage),
        ).toEqual(['updates'])
        expect(JSON.stringify(events)).not.toContain('raw')
    })

    test('propagates the first ordered action rejection when traffic succeeds and accepts fully successful rounds', async () => {
        const first = new Error('first action')
        const second = new Error('second action')
        const actions = Promise.allSettled([
            Promise.reject(first),
            Promise.reject(second),
            Promise.resolve(7),
        ])
        await expect(drainBeta2Round(actions, Promise.resolve())).rejects.toBe(first)
        await expect(
            drainBeta2Round(Promise.allSettled([Promise.resolve(7)]), Promise.resolve()),
        ).resolves.toBeUndefined()
    })

    test('a failing diagnostic sink never replaces the workload error', async () => {
        const diagnostics = createBeta2RoundDiagnostics(1, () => {
            throw new Error('sink failed')
        })
        const failure = new Error('original')
        await expect(
            diagnostics.span('bulk-disable', async () => {
                throw failure
            }),
        ).rejects.toBe(failure)
        expect(() => diagnostics.transportFailure('h0.beta2.test', failure)).not.toThrow()
    })
})

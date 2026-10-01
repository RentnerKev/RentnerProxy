import { describe, expect, test } from 'bun:test'

import { checkValkeyHealth } from '../server/valkey/health.server'

describe('checkValkeyHealth', () => {
    test('returns connected only for the Valkey PONG response', async () => {
        const warnings: string[] = []

        expect(
            await checkValkeyHealth({
                createProbe: () => Promise.resolve('PONG'),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'connected' })
        expect(warnings).toEqual([])

        expect(
            await checkValkeyHealth({
                createProbe: () => Promise.resolve('unexpected'),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['invalid_result'])
    })

    test('returns unavailable when Valkey is not configured or the probe rejects', async () => {
        const warnings: string[] = []

        expect(
            await checkValkeyHealth({
                createProbe: () => null,
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['invalid_configuration'])

        warnings.length = 0
        expect(
            await checkValkeyHealth({
                createProbe: () => Promise.reject(new Error('redis://user:secret@valkey.example')),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['request_failed'])
        expect(warnings.join(' ')).not.toContain('secret')
    })

    test('times out without crashing the foundation health flow', async () => {
        const warnings: string[] = []

        expect(
            await checkValkeyHealth({
                createProbe: () => new Promise(() => undefined),
                timeoutMs: 0,
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['timeout'])
    })
})

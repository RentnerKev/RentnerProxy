import { describe, expect, test } from 'bun:test'

import { checkRedisHealth } from '../server/redis/health.server'

describe('checkRedisHealth', () => {
    test('returns connected only for the Redis PONG response', async () => {
        const warnings: string[] = []

        expect(
            await checkRedisHealth({
                createProbe: () => Promise.resolve('PONG'),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'connected' })
        expect(warnings).toEqual([])

        expect(
            await checkRedisHealth({
                createProbe: () => Promise.resolve('unexpected'),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['invalid_result'])
    })

    test('returns unavailable when Redis is not configured or the probe rejects', async () => {
        const warnings: string[] = []

        expect(
            await checkRedisHealth({
                createProbe: () => null,
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['invalid_configuration'])

        warnings.length = 0
        expect(
            await checkRedisHealth({
                createProbe: () => Promise.reject(new Error('redis://user:secret@redis.example')),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['request_failed'])
        expect(warnings.join(' ')).not.toContain('secret')
    })

    test('times out without crashing the foundation health flow', async () => {
        const warnings: string[] = []

        expect(
            await checkRedisHealth({
                createProbe: () => new Promise(() => undefined),
                timeoutMs: 0,
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['timeout'])
    })
})

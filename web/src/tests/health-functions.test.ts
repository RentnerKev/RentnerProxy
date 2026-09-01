import { describe, expect, test } from 'bun:test'

import {
    checkFoundationHealth,
    checkFoundationReadiness,
} from '../server/Foundation/health.service'

describe('checkFoundationHealth', () => {
    test('keeps the web health response available when the database check throws', async () => {
        const warnings: string[] = []

        const result = await checkFoundationHealth({
            checkController: async () => ({ state: 'connected' }),
            checkDatabase: () => Promise.reject(new Error('database connection failed')),
            checkRedis: async () => ({ state: 'connected' }),
            warn: (service) => warnings.push(service),
        })

        expect(result).toEqual({
            controller: { state: 'connected' },
            database: { state: 'unavailable' },
            redis: { state: 'connected' },
        })
        expect(warnings).toEqual(['database'])
    })

    test('reports each dependency independently', async () => {
        const result = await checkFoundationHealth({
            checkController: async () => ({ state: 'unavailable' }),
            checkDatabase: async () => ({ state: 'connected' }),
            checkRedis: async () => ({ state: 'unavailable' }),
            warn: () => undefined,
        })

        expect(result).toEqual({
            controller: { state: 'unavailable' },
            database: { state: 'connected' },
            redis: { state: 'unavailable' },
        })
    })

    test('keeps controller and database results when the Redis check throws', async () => {
        const warnings: string[] = []

        const result = await checkFoundationHealth({
            checkController: async () => ({ state: 'connected' }),
            checkDatabase: async () => ({ state: 'connected' }),
            checkRedis: () => Promise.reject(new Error('Redis connection failed')),
            warn: (service) => warnings.push(service),
        })

        expect(result).toEqual({
            controller: { state: 'connected' },
            database: { state: 'connected' },
            redis: { state: 'unavailable' },
        })
        expect(warnings).toEqual(['redis'])
    })
})

describe('checkFoundationReadiness', () => {
    test('is ready only when database, Redis, and controller readiness are connected', async () => {
        expect(
            await checkFoundationReadiness({
                checkController: async () => ({ state: 'connected' }),
                checkDatabase: async () => ({ state: 'connected' }),
                checkRedis: async () => ({ state: 'connected' }),
                warn: () => undefined,
            }),
        ).toBe(true)

        expect(
            await checkFoundationReadiness({
                checkController: async () => ({ state: 'unavailable' }),
                checkDatabase: async () => ({ state: 'connected' }),
                checkRedis: async () => ({ state: 'connected' }),
                warn: () => undefined,
            }),
        ).toBe(false)
    })
})

import { describe, expect, test } from 'bun:test'

import {
    checkFoundationHealthService,
    checkFoundationReadinessService,
} from '@/server/Foundation/health.service.ts'

describe('checkFoundationHealthService', () => {
    test('keeps the web health response available when the database check throws', async () => {
        const warnings: string[] = []

        const result = await checkFoundationHealthService({
            checkController: async () => ({ state: 'connected' }),
            checkDatabase: () => Promise.reject(new Error('database connection failed')),
            checkValkey: async () => ({ state: 'connected' }),
            warn: (service) => warnings.push(service),
        })

        expect(result).toEqual({
            controller: { state: 'connected' },
            database: { state: 'unavailable' },
            valkey: { state: 'connected' },
        })
        expect(warnings).toEqual(['database'])
    })

    test('reports each dependency independently', async () => {
        const result = await checkFoundationHealthService({
            checkController: async () => ({ state: 'unavailable' }),
            checkDatabase: async () => ({ state: 'connected' }),
            checkValkey: async () => ({ state: 'unavailable' }),
            warn: () => undefined,
        })

        expect(result).toEqual({
            controller: { state: 'unavailable' },
            database: { state: 'connected' },
            valkey: { state: 'unavailable' },
        })
    })

    test('keeps controller and database results when the Valkey check throws', async () => {
        const warnings: string[] = []

        const result = await checkFoundationHealthService({
            checkController: async () => ({ state: 'connected' }),
            checkDatabase: async () => ({ state: 'connected' }),
            checkValkey: () => Promise.reject(new Error('Valkey connection failed')),
            warn: (service) => warnings.push(service),
        })

        expect(result).toEqual({
            controller: { state: 'connected' },
            database: { state: 'connected' },
            valkey: { state: 'unavailable' },
        })
        expect(warnings).toEqual(['valkey'])
    })
})

describe('checkFoundationReadinessService', () => {
    test('is ready only when database, Valkey, and controller readiness are connected', async () => {
        expect(
            await checkFoundationReadinessService({
                checkController: async () => ({ state: 'connected' }),
                checkDatabase: async () => ({ state: 'connected' }),
                checkValkey: async () => ({ state: 'connected' }),
                warn: () => undefined,
            }),
        ).toBe(true)

        expect(
            await checkFoundationReadinessService({
                checkController: async () => ({ state: 'unavailable' }),
                checkDatabase: async () => ({ state: 'connected' }),
                checkValkey: async () => ({ state: 'connected' }),
                warn: () => undefined,
            }),
        ).toBe(false)
    })
})

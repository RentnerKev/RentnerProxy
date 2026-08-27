import { describe, expect, test } from 'bun:test'

import { checkFoundationHealth } from '../server/health.server'

describe('checkFoundationHealth', () => {
    test('keeps the web health response available when the database check throws', async () => {
        const warnings: string[] = []

        const result = await checkFoundationHealth({
            checkController: async () => ({ state: 'connected' }),
            checkDatabase: () => Promise.reject(new Error('database connection failed')),
            warn: (service) => warnings.push(service),
        })

        expect(result).toEqual({
            controller: { state: 'connected' },
            database: { state: 'unavailable' },
        })
        expect(warnings).toEqual(['database'])
    })

    test('reports each dependency independently', async () => {
        const result = await checkFoundationHealth({
            checkController: async () => ({ state: 'unavailable' }),
            checkDatabase: async () => ({ state: 'connected' }),
            warn: () => undefined,
        })

        expect(result).toEqual({
            controller: { state: 'unavailable' },
            database: { state: 'connected' },
        })
    })
})

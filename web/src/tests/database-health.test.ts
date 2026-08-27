import { describe, expect, test } from 'bun:test'

import { checkDatabaseHealth, parseDatabaseHealthResult } from '../db/health.server'

describe('parseDatabaseHealthResult', () => {
    test('accepts only the expected SELECT 1 result', () => {
        expect(parseDatabaseHealthResult([{ health: 1 }])).toBeTrue()
        expect(parseDatabaseHealthResult([{ health: '1' }])).toBeFalse()
        expect(parseDatabaseHealthResult([{ health: 1 }, { health: 1 }])).toBeFalse()
        expect(parseDatabaseHealthResult(null)).toBeFalse()
    })
})

describe('checkDatabaseHealth', () => {
    test('returns connected for a valid database probe', async () => {
        const warnings: string[] = []

        expect(
            await checkDatabaseHealth({
                createProbe: () => ({
                    result: Promise.resolve([{ health: 1 }]),
                    cancel: () => undefined,
                }),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'connected' })
        expect(warnings).toEqual([])
    })

    test('returns unavailable when configuration is missing', async () => {
        const warnings: string[] = []

        expect(
            await checkDatabaseHealth({
                createProbe: () => null,
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['invalid_configuration'])
    })

    test('classifies a connection failure without logging its error message', async () => {
        const warnings: string[] = []
        const error = Object.assign(
            new Error('postgresql://user:password@database.example/rentnerproxy'),
            {
                code: 'ERR_POSTGRES_CONNECTION_REFUSED',
            },
        )

        expect(
            await checkDatabaseHealth({
                createProbe: () => ({
                    result: Promise.reject(error),
                    cancel: () => undefined,
                }),
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(warnings).toEqual(['connection_refused'])
        expect(warnings.join(' ')).not.toContain('password')
    })

    test('cancels a slow probe and resolves unavailable without throwing', async () => {
        const warnings: string[] = []
        let cancelled = false

        expect(
            await checkDatabaseHealth({
                createProbe: () => ({
                    result: new Promise(() => undefined),
                    cancel: () => {
                        cancelled = true
                    },
                }),
                timeoutMs: 0,
                warn: (reason) => warnings.push(reason),
            }),
        ).toEqual({ state: 'unavailable' })
        expect(cancelled).toBeTrue()
        expect(warnings).toEqual(['timeout'])
    })
})

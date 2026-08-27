import { afterEach, describe, expect, test } from 'bun:test'

import { getControllerBaseUrl, parseDatabaseUrl } from '../server/env.server'

const VARIABLE = 'RENTNERPROXY_CONTROLLER_URL'
const originalValue = process.env[VARIABLE]

afterEach(() => {
    if (originalValue === undefined) {
        delete process.env[VARIABLE]
        return
    }

    process.env[VARIABLE] = originalValue
})

describe('getControllerBaseUrl', () => {
    test('uses the loopback default only when the variable is absent', () => {
        delete process.env[VARIABLE]

        expect(getControllerBaseUrl()).toBe('http://127.0.0.1:8081')
    })

    test('rejects an explicitly blank value', () => {
        process.env[VARIABLE] = '   '

        expect(getControllerBaseUrl()).toBeNull()
    })

    test('normalizes a valid configured URL', () => {
        process.env[VARIABLE] = ' https://controller.example:8443/ '

        expect(getControllerBaseUrl()).toBe('https://controller.example:8443')
    })
})

describe('parseDatabaseUrl', () => {
    test('returns null when the server-only variable is absent or blank', () => {
        expect(parseDatabaseUrl(undefined)).toBeNull()
        expect(parseDatabaseUrl('   ')).toBeNull()
    })

    test('accepts only complete PostgreSQL connection URLs', () => {
        expect(parseDatabaseUrl('mysql://database.example/rentnerproxy')).toBeNull()
        expect(parseDatabaseUrl('postgresql://database.example')).toBeNull()
        expect(parseDatabaseUrl('postgresql://database.example/rentnerproxy#secret')).toBeNull()
    })

    test('normalizes a valid PostgreSQL URL without exposing it outside the server module', () => {
        expect(
            parseDatabaseUrl(' postgresql://database.example:5432/rentnerproxy?sslmode=require '),
        ).toBe('postgresql://database.example:5432/rentnerproxy?sslmode=require')
    })
})

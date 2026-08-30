import { afterEach, describe, expect, test } from 'bun:test'

import {
    getAppUrl,
    getControllerBaseUrl,
    getRedisUrl,
    getSmtpConfiguration,
    parseAppUrl,
    parseDatabaseUrl,
    parseRedisUrl,
} from '../server/env.server'

const ENVIRONMENT_VARIABLES = [
    'APP_URL',
    'NODE_ENV',
    'REDIS_URL',
    'RENTNERPROXY_CONTROLLER_URL',
    'SMTP_FROM',
    'SMTP_HOST',
    'SMTP_PASSWORD',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
] as const
const originalValues = new Map(
    ENVIRONMENT_VARIABLES.map((variable) => [variable, process.env[variable]] as const),
)

afterEach(() => {
    for (const variable of ENVIRONMENT_VARIABLES) {
        const originalValue = originalValues.get(variable)

        if (originalValue === undefined) {
            delete process.env[variable]
        } else {
            process.env[variable] = originalValue
        }
    }
})

function configureRequiredSmtp(): void {
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = '587'
    process.env.SMTP_SECURE = 'false'
    process.env.SMTP_FROM = 'RentnerProxy <noreply@example.com>'
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
}

describe('getControllerBaseUrl', () => {
    test('uses the loopback default only when the variable is absent', () => {
        delete process.env.RENTNERPROXY_CONTROLLER_URL

        expect(getControllerBaseUrl()).toBe('http://127.0.0.1:8081')
    })

    test('rejects an explicitly blank value', () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = '   '

        expect(getControllerBaseUrl()).toBeNull()
    })

    test('normalizes a valid configured URL', () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = ' https://controller.example:8443/ '

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

describe('getRedisUrl', () => {
    test('returns null when REDIS_URL is absent, blank, or not Redis', () => {
        delete process.env.REDIS_URL
        expect(getRedisUrl()).toBeNull()
        expect(parseRedisUrl('   ')).toBeNull()
        expect(parseRedisUrl('https://redis.example')).toBeNull()
        expect(parseRedisUrl('redis://redis.example/not-a-database')).toBeNull()
        expect(parseRedisUrl('redis://redis.example/0?secret=value')).toBeNull()
    })

    test('accepts redis and rediss URLs, database indexes, and credentials', () => {
        expect(parseRedisUrl('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379')
        expect(parseRedisUrl(' rediss://user:password@redis.example:6380/2 ')).toBe(
            'rediss://user:password@redis.example:6380/2',
        )
    })
})

describe('getAppUrl', () => {
    test('defaults to the local web origin outside production', () => {
        delete process.env.APP_URL
        process.env.NODE_ENV = 'development'

        expect(getAppUrl()).toBe('http://localhost:5173')
    })

    test('requires APP_URL in production', () => {
        delete process.env.APP_URL
        process.env.NODE_ENV = 'production'

        expect(getAppUrl()).toBeNull()
        expect(parseAppUrl('http://app.example')).toBeNull()
        expect(parseAppUrl('https://app.example')).toBe('https://app.example')
    })

    test('rejects explicit invalid values and normalizes an origin', () => {
        process.env.NODE_ENV = 'development'
        expect(parseAppUrl('   ')).toBeNull()
        expect(parseAppUrl('https://app.example/path')).toBeNull()
        expect(parseAppUrl('https://user:secret@app.example')).toBeNull()
        expect(parseAppUrl(' https://app.example:8443/ ')).toBe('https://app.example:8443')
    })
})

describe('getSmtpConfiguration', () => {
    test('returns null unless every required field is valid', () => {
        configureRequiredSmtp()
        delete process.env.SMTP_PORT
        expect(getSmtpConfiguration()).toBeNull()

        configureRequiredSmtp()
        process.env.SMTP_PORT = '0'
        expect(getSmtpConfiguration()).toBeNull()

        configureRequiredSmtp()
        process.env.SMTP_PORT = '65536'
        expect(getSmtpConfiguration()).toBeNull()

        configureRequiredSmtp()
        process.env.SMTP_SECURE = 'TRUE'
        expect(getSmtpConfiguration()).toBeNull()

        configureRequiredSmtp()
        process.env.SMTP_FROM = 'noreply@example.com\nBcc: attacker@example.com'
        expect(getSmtpConfiguration()).toBeNull()
    })

    test('returns a complete configuration without optional credentials', () => {
        configureRequiredSmtp()

        expect(getSmtpConfiguration()).toEqual({
            from: 'RentnerProxy <noreply@example.com>',
            host: 'smtp.example.com',
            port: 587,
            secure: false,
        })

        process.env.SMTP_USER = '   '
        process.env.SMTP_PASSWORD = ''
        expect(getSmtpConfiguration()).toEqual({
            from: 'RentnerProxy <noreply@example.com>',
            host: 'smtp.example.com',
            port: 587,
            secure: false,
        })
    })

    test('accepts only paired non-empty username and password values', () => {
        configureRequiredSmtp()
        process.env.SMTP_USER = 'mailer'
        expect(getSmtpConfiguration()).toBeNull()

        process.env.SMTP_PASSWORD = ' secret '
        expect(getSmtpConfiguration()).toEqual({
            from: 'RentnerProxy <noreply@example.com>',
            host: 'smtp.example.com',
            password: 'secret',
            port: 587,
            secure: false,
            user: 'mailer',
        })

        process.env.SMTP_PASSWORD = '   '
        expect(getSmtpConfiguration()).toBeNull()
    })
})

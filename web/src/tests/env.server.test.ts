import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
    getAppEncryptionKey,
    getControllerBaseUrl,
    getControllerToken,
    getDatabaseUrl,
    getPublicOrigin,
    getRedisUrl,
    getSmtpConfiguration,
    getWebAuthnConfiguration,
    deriveWebAuthnRpId,
    parseAppEncryptionKey,
    parseDatabaseUrl,
    parsePublicOrigin,
    parseRedisUrl,
    parseTrustedManagementOrigin,
    parseWebAuthnRpId,
    validateProductionEnvironment,
} from '../server/env.server'

const ENVIRONMENT_VARIABLES = [
    'APP_URL',
    'WEBAUTHN_RP_ID',
    'APP_ENCRYPTION_KEY',
    'APP_ENCRYPTION_KEY_FILE',
    'DATABASE_URL',
    'DATABASE_URL_FILE',
    'NODE_ENV',
    'REDIS_URL',
    'RENTNERPROXY_CONTROLLER_TOKEN',
    'RENTNERPROXY_CONTROLLER_TOKEN_FILE',
    'RENTNERPROXY_CONTROLLER_URL',
    'SMTP_FROM',
    'SMTP_HOST',
    'SMTP_PASSWORD',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'RENTNERPROXY_PUBLIC_ORIGIN',
] as const
const originalValues = new Map(
    ENVIRONMENT_VARIABLES.map((variable) => [variable, process.env[variable]] as const),
)
const temporaryDirectories: string[] = []

afterEach(() => {
    for (const variable of ENVIRONMENT_VARIABLES) {
        const originalValue = originalValues.get(variable)

        if (originalValue === undefined) {
            delete process.env[variable]
        } else {
            process.env[variable] = originalValue
        }
    }
    while (temporaryDirectories.length > 0) {
        rmSync(temporaryDirectories.pop()!, { force: true, recursive: true })
    }
})

function secretFile(value: string): string {
    const directory = mkdtempSync(join(tmpdir(), 'rentnerproxy-secret-test-'))
    const path = join(directory, 'secret')
    temporaryDirectories.push(directory)
    writeFileSync(path, value, { encoding: 'utf8', mode: 0o600 })
    return path
}

function configureRequiredSmtp(): void {
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_PORT = '587'
    process.env.SMTP_SECURE = 'false'
    process.env.SMTP_FROM = 'RentnerProxy <noreply@example.com>'
    delete process.env.SMTP_USER
    delete process.env.SMTP_PASSWORD
}

function configureRequiredProductionEnvironment(): void {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgresql://rentnerproxy:secret@postgres:5432/rentnerproxy'
    process.env.REDIS_URL = 'redis://redis:6379'
    process.env.APP_ENCRYPTION_KEY = Buffer.from('01234567890123456789012345678901').toString(
        'base64',
    )
    process.env.RENTNERPROXY_CONTROLLER_URL = 'http://127.0.0.1:8081'
    process.env.RENTNERPROXY_CONTROLLER_TOKEN = '0'.repeat(32)
    process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://management.example.com'
    delete process.env.APP_ENCRYPTION_KEY_FILE
    delete process.env.DATABASE_URL_FILE
    delete process.env.RENTNERPROXY_CONTROLLER_TOKEN_FILE
    configureRequiredSmtp()
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

describe('getPublicOrigin', () => {
    test('ignores retired environment overrides and derives the exact relying party host', () => {
        process.env.NODE_ENV = 'production'
        process.env.APP_URL = 'https://retired.example.com'
        process.env.WEBAUTHN_RP_ID = 'retired.example.com'
        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://management.example.com:8443/'

        expect(getPublicOrigin()).toBe('https://management.example.com:8443')
        expect(getWebAuthnConfiguration()).toMatchObject({
            origin: 'https://management.example.com:8443',
            rpId: 'management.example.com',
        })
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
        expect(getPublicOrigin()).toBeNull()
        expect(getWebAuthnConfiguration()).toBeNull()
    })

    test('defaults to the local web origin outside production', () => {
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
        process.env.NODE_ENV = 'development'

        expect(getPublicOrigin()).toBe('http://localhost:5173')
    })

    test('requires an HTTPS deployment origin in production', () => {
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN
        process.env.NODE_ENV = 'production'

        expect(getPublicOrigin()).toBeNull()
        expect(parsePublicOrigin('http://app.example', 'production')).toBeNull()
        expect(parsePublicOrigin('http://localhost:81', 'production')).toBeNull()
        expect(parsePublicOrigin('http://127.0.0.1:81', 'production')).toBeNull()
        expect(parsePublicOrigin('http://[::1]:81', 'production')).toBeNull()
        expect(parsePublicOrigin('https://app.example', 'production')).toBe('https://app.example')
    })

    test('rejects explicit invalid values and normalizes an origin', () => {
        process.env.NODE_ENV = 'development'
        expect(parsePublicOrigin('   ')).toBeNull()
        expect(parsePublicOrigin('app.example')).toBeNull()
        expect(parsePublicOrigin('https://app.example/path')).toBeNull()
        expect(parsePublicOrigin('https://user:secret@app.example')).toBeNull()
        expect(parsePublicOrigin('https://@app.example')).toBeNull()
        expect(parsePublicOrigin(' https://app.example:8443/ ')).toBe('https://app.example:8443')
        expect(parsePublicOrigin('http://localhost:81')).toBe('http://localhost:81')
        expect(parsePublicOrigin('http://127.0.0.1:81')).toBe('http://127.0.0.1:81')
        expect(parsePublicOrigin('http://[::1]:81')).toBe('http://[::1]:81')
    })
})

describe('parseTrustedManagementOrigin', () => {
    test('accepts HTTPS origins and loopback HTTP origins', () => {
        expect(parseTrustedManagementOrigin('https://admin.example.com/')).toBe(
            'https://admin.example.com',
        )
        expect(parseTrustedManagementOrigin('http://localhost:81')).toBe('http://localhost:81')
        expect(parseTrustedManagementOrigin('http://127.0.0.1:81')).toBe('http://127.0.0.1:81')
        expect(parseTrustedManagementOrigin('http://[::1]:81')).toBe('http://[::1]:81')
    })

    test('rejects insecure external origins and non-origin input', () => {
        expect(parseTrustedManagementOrigin('http://admin.example.com')).toBeNull()
        expect(parseTrustedManagementOrigin('https://admin.example.com/path')).toBeNull()
        expect(parseTrustedManagementOrigin('https://admin.example.com?next=/')).toBeNull()
        expect(parseTrustedManagementOrigin('https://user:secret@admin.example.com')).toBeNull()
    })
})

describe('production environment validation', () => {
    test('requires the canonical origin and provides the Alpha 3 migration hint', () => {
        configureRequiredProductionEnvironment()
        delete process.env.RENTNERPROXY_PUBLIC_ORIGIN

        expect(() => validateProductionEnvironment()).toThrow('RENTNERPROXY_PUBLIC_ORIGIN')
        expect(() => validateProductionEnvironment()).toThrow('management_origin_v1')
    })
})

describe('application encryption key', () => {
    const validKey = Buffer.from('01234567890123456789012345678901').toString('base64')

    test('accepts exactly 32 decoded bytes and rejects malformed values', () => {
        expect(parseAppEncryptionKey(validKey)).toHaveLength(32)
        expect(parseAppEncryptionKey(undefined)).toBeNull()
        expect(parseAppEncryptionKey('   ')).toBeNull()
        expect(parseAppEncryptionKey(validKey.slice(0, -2))).toBeNull()
        expect(parseAppEncryptionKey(`${validKey.slice(0, -2)}$$`)).toBeNull()
    })

    test('reads the key only from the server environment', () => {
        process.env.APP_ENCRYPTION_KEY = validKey

        expect(getAppEncryptionKey()).toHaveLength(32)

        delete process.env.APP_ENCRYPTION_KEY
        expect(getAppEncryptionKey()).toBeNull()
    })
})

describe('server-only secret files', () => {
    const validKey = Buffer.from('01234567890123456789012345678901').toString('base64')
    const validToken = '00000000000000000000000000000000'
    const validDatabaseUrl = 'postgresql://rentnerproxy:secret@postgres:5432/rentnerproxy'

    test('reads generated secrets from bounded files', () => {
        delete process.env.APP_ENCRYPTION_KEY
        delete process.env.DATABASE_URL
        delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
        process.env.APP_ENCRYPTION_KEY_FILE = secretFile(`${validKey}\n`)
        process.env.DATABASE_URL_FILE = secretFile(`${validDatabaseUrl}\n`)
        process.env.RENTNERPROXY_CONTROLLER_TOKEN_FILE = secretFile(`${validToken}\n`)

        expect(getAppEncryptionKey()).toHaveLength(32)
        expect(getDatabaseUrl()).toBe(validDatabaseUrl)
        expect(getControllerToken()).toBe(validToken)
    })

    test('rejects ambiguous direct and file-based secret sources', () => {
        process.env.APP_ENCRYPTION_KEY = validKey
        process.env.APP_ENCRYPTION_KEY_FILE = secretFile(validKey)

        expect(getAppEncryptionKey()).toBeNull()
    })

    test('rejects relative, non-regular, and oversized secret file sources', () => {
        process.env.DATABASE_URL_FILE = 'relative-secret'
        expect(getDatabaseUrl()).toBeNull()

        const directory = mkdtempSync(join(tmpdir(), 'rentnerproxy-secret-directory-test-'))
        temporaryDirectories.push(directory)
        process.env.DATABASE_URL_FILE = directory
        expect(getDatabaseUrl()).toBeNull()

        process.env.DATABASE_URL_FILE = secretFile('x'.repeat(4_097))
        expect(getDatabaseUrl()).toBeNull()
    })
})

describe('WebAuthn relying-party configuration', () => {
    test('requires an exact RP hostname match and rejects malformed IDs', () => {
        expect(parseWebAuthnRpId('localhost', 'http://localhost:3000')).toBe('localhost')
        expect(parseWebAuthnRpId('APP.EXAMPLE', 'https://app.example')).toBe('app.example')
        expect(parseWebAuthnRpId('example.com', 'https://login.example.com')).toBeNull()
        expect(parseWebAuthnRpId('https://app.example', 'https://app.example')).toBeNull()
        expect(parseWebAuthnRpId('app.example:443', 'https://app.example')).toBeNull()
        expect(parseWebAuthnRpId(undefined, 'https://app.example')).toBeNull()
        expect(parseWebAuthnRpId('app.example', null)).toBeNull()
    })

    test('rejects matching IPv4 and IPv6 origins and RP IDs', () => {
        process.env.NODE_ENV = 'development'

        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'http://127.0.0.1:5173'
        expect(parseWebAuthnRpId('127.0.0.1', 'http://127.0.0.1:5173')).toBeNull()
        expect(deriveWebAuthnRpId('http://127.0.0.1:5173')).toBeNull()
        expect(getWebAuthnConfiguration()).toBeNull()

        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'http://[::1]:5173'
        expect(parseWebAuthnRpId('::1', 'http://[::1]:5173')).toBeNull()
        expect(deriveWebAuthnRpId('http://[::1]:5173')).toBeNull()
        expect(getWebAuthnConfiguration()).toBeNull()
    })

    test('derives the RP ID from the canonical public origin', () => {
        process.env.NODE_ENV = 'development'
        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'http://localhost:3000'

        expect(getWebAuthnConfiguration()).toEqual({
            origin: 'http://localhost:3000',
            rpId: 'localhost',
            rpName: 'RentnerProxy',
        })

        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'http://127.0.0.1:3000'
        expect(getWebAuthnConfiguration()).toBeNull()

        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://app.example'
        expect(getWebAuthnConfiguration()).toEqual({
            origin: 'https://app.example',
            rpId: 'app.example',
            rpName: 'RentnerProxy',
        })

        process.env.RENTNERPROXY_PUBLIC_ORIGIN = 'https://app.example:8443'
        expect(getWebAuthnConfiguration()).toEqual({
            origin: 'https://app.example:8443',
            rpId: 'app.example',
            rpName: 'RentnerProxy',
        })
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

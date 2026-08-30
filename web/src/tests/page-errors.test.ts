import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { PUBLIC_ENGLISH } from '../config/language.config'
import { createPageError, getPageErrorDetails } from '../shared/Helpers/pageError'
import { catalogs } from './Helpers/withTestLanguage'

const reference = '00000000-0000-4000-8000-000000000001'
const sensitiveFixture = 'SELECT synthetic_secret FROM private_fixture WHERE token=fixture-token'

describe('safe page error diagnostics', () => {
    test.each([
        ['42703', 'DATABASE_SCHEMA', 503],
        ['42P01', 'DATABASE_SCHEMA', 503],
        ['3F000', 'DATABASE_SCHEMA', 503],
        ['53300', 'DATABASE_BUSY', 503],
        ['28P01', 'DATABASE_AUTHENTICATION', 503],
        ['28000', 'DATABASE_AUTHENTICATION', 503],
        ['ERR_POSTGRES_AUTHENTICATION_FAILED', 'DATABASE_AUTHENTICATION', 503],
        ['3D000', 'DATABASE_UNAVAILABLE', 503],
        ['57P01', 'DATABASE_UNAVAILABLE', 503],
        ['08006', 'DATABASE_UNAVAILABLE', 503],
        ['ERR_POSTGRES_CONNECTION_REFUSED', 'DATABASE_UNAVAILABLE', 503],
        ['ERR_POSTGRES_CONNECTION_TIMEOUT', 'DATABASE_UNAVAILABLE', 503],
        ['authentication_required', 'SESSION_EXPIRED', 401],
        ['permission_denied', 'ACCESS_DENIED', 403],
        ['user_not_found', 'NOT_FOUND', 404],
        ['RATE_LIMITED', 'RATE_LIMITED', 429],
        ['RATE_LIMIT_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 503],
    ] as const)('classifies %s without displaying its raw message', (code, category, status) => {
        const error = Object.assign(new Error(sensitiveFixture), { code })
        const details = getPageErrorDetails(error)
        expect(details.code).toBe(`RP_${category}`)
        expect(details.status).toBe(status)
        expect(JSON.stringify(details)).not.toContain(sensitiveFixture)
    })

    test('recognizes Bun SQLSTATE through Drizzle causes and generic service wrappers', () => {
        const driverError = Object.assign(new Error(sensitiveFixture), {
            code: 'ERR_POSTGRES_SERVER_ERROR',
            errno: '42703',
        })
        const queryError = new Error(sensitiveFixture, { cause: driverError })
        const wrapper = Object.assign(
            new Error('errors.service_unavailable', { cause: queryError }),
            {
                statusCode: 503,
            },
        )
        expect(getPageErrorDetails(wrapper)).toMatchObject({
            code: 'RP_DATABASE_SCHEMA',
            command: 'bun run db:migrate',
        })
        expect(getPageErrorDetails({ sqlState: '53300' }).code).toBe('RP_DATABASE_BUSY')
    })

    test.each([
        [new Error('errors.permission_denied'), 'ACCESS_DENIED'],
        [new Error('errors.rateLimited'), 'RATE_LIMITED'],
        [new Error('errors.authUnavailable'), 'SERVICE_UNAVAILABLE'],
        [{ status: 403 }, 'ACCESS_DENIED'],
        [{ statusCode: 429 }, 'RATE_LIMITED'],
        [new TypeError('Failed to fetch'), 'NETWORK'],
        [new Error('language.loadFailed'), 'ASSET_LOAD'],
        [
            new TypeError('Failed to fetch dynamically imported module: /assets/fixture.js'),
            'ASSET_LOAD',
        ],
        [{ name: 'ChunkLoadError' }, 'ASSET_LOAD'],
    ] as const)('recognizes a known route or client failure %#', (error, category) => {
        const details = getPageErrorDetails(error)
        expect(details.code).toBe(`RP_${category}`)
        expect(details.reload).toBe(category === 'ASSET_LOAD')
        expect(details.command).toBeNull()
    })

    test('keeps unrecognized, malformed, and cyclic errors safe', () => {
        const cycle: { cause?: unknown } = {}
        cycle.cause = cycle
        for (const error of [
            undefined,
            null,
            sensitiveFixture,
            new Error(sensitiveFixture),
            new Error(`RP_UNKNOWN:${reference}`),
            new Error('RP_DATABASE_SCHEMA:fixture-token'),
            new Error(`RP_DATABASE_SCHEMA:${reference}\n${sensitiveFixture}`),
            { code: 'constructor', message: 'errors.__proto__' },
            cycle,
        ]) {
            expect(getPageErrorDetails(error)).toMatchObject({
                code: 'RP_UNEXPECTED',
                status: 500,
                reference: null,
                command: null,
                reload: false,
            })
            expect(JSON.stringify(getPageErrorDetails(error))).not.toContain(sensitiveFixture)
        }
    })

    test('preserves an existing reference and gives new failures distinct references', () => {
        const existing = new Error(`RP_DATABASE_BUSY:${reference}`)
        expect(createPageError(existing).message).toBe(existing.message)
        expect(getPageErrorDetails(existing).reference).toBe(reference)
        const first = createPageError(new Error(sensitiveFixture))
        const second = createPageError(new Error(sensitiveFixture))
        expect(first.message).toMatch(/^RP_UNEXPECTED:[a-f0-9-]{36}$/u)
        expect(first.message).not.toBe(second.message)
        expect(first.cause).toBeUndefined()
    })

    test('retains the diagnosis from the public message-only error contract without secrets', () => {
        const original = Object.assign(new Error(sensitiveFixture), { errno: '42703' })
        const safe = createPageError(original)
        const payload = JSON.stringify({ message: safe.message })
        const received: unknown = JSON.parse(payload)

        expect(getPageErrorDetails(received)).toEqual(getPageErrorDetails(safe))
        expect(getPageErrorDetails(received).code).toBe('RP_DATABASE_SCHEMA')
        expect(safe.cause).toBeUndefined()
        expect(payload).not.toContain(sensitiveFixture)
        expect(payload).not.toContain('fixture-token')
        expect(payload).not.toContain('pageError.ts')
    })

    test('matches public English diagnostic copy to the authenticated English catalog', () => {
        const entries = Object.entries(PUBLIC_ENGLISH).filter(([key]) =>
            key.startsWith('system.error.'),
        )
        expect(entries.length).toBeGreaterThan(35)
        for (const [key, text] of entries) {
            let value: unknown = catalogs.en
            for (const part of key.split('.')) {
                value = (value as Record<string, unknown>)[part]
            }
            expect(value, key).toBe(text)
        }
    })

    test('sanitizes auth-state loader failures before they leave the server', async () => {
        // Isolate module mocks: other suites exercise the real server functions and services.
        const script = `
            import { mock } from 'bun:test'
            let responseStatus = 200
            let failure = new Error('SELECT synthetic_secret token=fixture-token', {
                cause: Object.assign(new Error('postgres://fixture:secret@localhost/private'), {
                    code: 'ERR_POSTGRES_SERVER_ERROR', errno: '42703'
                })
            })
            failure.stack = 'Error: SELECT synthetic_secret token=fixture-token' + '\\n' +
                '    at loadUser (C:/private-fixture/web/src/server/Auth/Access/rbac.service.ts:80:12)' + '\\n' +
                '    at request (https://fixture:secret@example.invalid/fixture-token:1:1)'
            const logs = []
            console.error = (...values) => logs.push(values)
            mock.module('@tanstack/react-start', () => ({
                createServerFn: () => ({ handler: (handler) => handler })
            }))
            mock.module('@tanstack/react-start/server', () => ({
                getRequest: () => new Request('http://localhost'),
                getRequestIP: () => '127.0.0.1',
                setResponseHeader: () => {},
                setResponseStatus: (status) => { responseStatus = status }
            }))
            mock.module('./server/Auth/Access/auth-state.service.ts', () => ({
                getAuthStateService: async () => {
                    if (failure) throw failure
                    return { setupRequired: true, user: null }
                }
            }))
            mock.module('./server/Auth/Access/cookies.server.ts', () => ({ clearSessionCookie() {} }))
            mock.module('./server/Auth/Access/sessions.service.ts', () => ({
                async revokeCurrentSessionService() {}
            }))
            const { getAuthStateHandler } = await import('./features/Auth/server.ts')
            const outputs = []
            for (let index = 0; index < 3; index++) {
                responseStatus = 200
                try {
                    outputs.push({ state: await getAuthStateHandler(), status: responseStatus })
                } catch (error) {
                    outputs.push({ message: error.message, status: responseStatus, cause: error.cause ?? null })
                }
                failure = index === 0 ? new Error('fixture-token unexpected secret') : null
            }
            console.log(JSON.stringify({ outputs, logs }))
        `
        const child = Bun.spawn([process.execPath, '-e', script], {
            cwd: fileURLToPath(new URL('../', import.meta.url)),
            stdout: 'pipe',
            stderr: 'pipe',
        })
        const [output, errors, code] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
            child.exited,
        ])
        expect(code, errors).toBe(0)
        const result = JSON.parse(output)
        expect(result.outputs[0]).toMatchObject({ status: 503, cause: null })
        expect(result.outputs[0].message).toMatch(/^RP_DATABASE_SCHEMA:[a-f0-9-]{36}$/u)
        expect(result.outputs[1]).toMatchObject({ status: 500, cause: null })
        expect(result.outputs[1].message).toMatch(/^RP_UNEXPECTED:[a-f0-9-]{36}$/u)
        expect(result.outputs[2]).toEqual({
            state: { setupRequired: true, user: null },
            status: 200,
        })
        expect(result.logs).toHaveLength(2)
        expect(result.logs[0]).toEqual([
            '[page-error]',
            {
                code: 'RP_DATABASE_SCHEMA',
                reference: getPageErrorDetails(new Error(result.outputs[0].message)).reference,
                driverCodes: ['ERR_POSTGRES_SERVER_ERROR', '42703'],
                locations: ['web/src/server/Auth/Access/rbac.service.ts:80:12'],
            },
        ])
        expect(output).not.toContain('fixture-token')
        expect(output).not.toContain('postgres://')
        expect(output).not.toContain('SELECT')
        expect(output).not.toContain('private-fixture')
        expect(output).not.toContain('example.invalid')
    })
})

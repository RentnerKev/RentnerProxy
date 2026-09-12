import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import {
    PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES,
    proxyAccessLogsQuerySchema,
    proxyAccessLogsResultSchema,
} from '../features/Admin/ProxyAccessLogs/validation'
import { getProxyAccessLogs } from '../server/Foundation/controller.server'

const CONTROLLER_ENVIRONMENT = ['RENTNERPROXY_CONTROLLER_URL', 'RENTNERPROXY_CONTROLLER_TOKEN']
const originalEnvironment = new Map<string, string | undefined>()

for (const variable of CONTROLLER_ENVIRONMENT) {
    originalEnvironment.set(variable, process.env[variable])
}

const entry = {
    timestamp: '2026-09-12T10:20:30.123Z',
    host: 'example.com',
    method: 'GET',
    path: '/private',
    status: 200,
    durationMs: 4,
    clientIp: '203.0.113.10',
    upstream: '127.0.0.1:8080',
    bytes: 1_234,
    protocol: 'HTTP/2.0',
} as const

function restoreControllerEnvironment(): void {
    for (const variable of CONTROLLER_ENVIRONMENT) {
        const value = originalEnvironment.get(variable)
        if (value === undefined) delete process.env[variable]
        else process.env[variable] = value
    }
}

afterEach(restoreControllerEnvironment)

describe('proxy access-log validation', () => {
    test('normalizes bounded query filters and applies defaults', () => {
        expect(
            proxyAccessLogsQuerySchema.parse({
                host: ' Example.COM. ',
                search: ' status 200 ',
            }),
        ).toEqual({
            host: 'example.com',
            search: ' status 200 ',
            limit: 100,
            offset: 0,
        })
    })

    test('rejects unknown fields, invalid filters, controls, and oversized UTF-8 search', () => {
        for (const input of [
            { unknown: true },
            { status: 99 },
            { status: 600 },
            { limit: 0 },
            { limit: 201 },
            { offset: -1 },
            { offset: 10_001 },
            { host: '192.0.2.1' },
            { search: 'bad\u0000value' },
            { search: 'ä'.repeat(65) },
        ]) {
            expect(proxyAccessLogsQuerySchema.safeParse(input).success).toBeFalse()
        }
    })

    test('rejects secret-bearing or inconsistent controller responses', () => {
        expect(
            proxyAccessLogsResultSchema.safeParse({
                entries: [{ ...entry, method: 'custom-method' }],
                limit: 1,
                offset: 0,
                total: 1,
                hasMore: false,
                truncated: false,
            }).success,
        ).toBeTrue()
        expect(
            proxyAccessLogsResultSchema.safeParse({
                entries: [{ ...entry, method: 'x'.repeat(33) }],
                limit: 1,
                offset: 0,
                total: 1,
                hasMore: false,
                truncated: false,
            }).success,
        ).toBeFalse()
        expect(
            proxyAccessLogsResultSchema.safeParse({
                entries: [{ ...entry, path: '/private?token=secret' }],
                limit: 1,
                offset: 0,
                total: 1,
                hasMore: false,
                truncated: false,
            }).success,
        ).toBeFalse()
        expect(
            proxyAccessLogsResultSchema.safeParse({
                entries: [{ ...entry, authorization: 'Bearer secret' }],
                limit: 1,
                offset: 0,
                total: 1,
                hasMore: false,
                truncated: false,
            }).success,
        ).toBeFalse()
        expect(
            proxyAccessLogsResultSchema.safeParse({
                entries: [entry],
                limit: 1,
                offset: 0,
                total: 1,
                hasMore: true,
                truncated: true,
            }).success,
        ).toBeFalse()
        expect(
            proxyAccessLogsResultSchema.safeParse({
                entries: [],
                limit: 1,
                offset: 10,
                total: 1,
                hasMore: false,
                truncated: false,
            }).success,
        ).toBeTrue()
    })
})

describe('proxy access-log controller transport', () => {
    test('uses the privileged bearer transport and safely encodes filters', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'https://controller.example:8443'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'A'.repeat(32)
        const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
        ) => {
            const url = new URL(String(input))
            expect(url.pathname).toBe('/internal/v1/proxy/access-logs')
            expect(url.searchParams.get('host')).toBe('example.com')
            expect(url.searchParams.get('status')).toBe('401')
            expect(url.searchParams.get('search')).toBe('a&b?')
            expect(url.searchParams.get('limit')).toBe('20')
            expect(url.searchParams.get('offset')).toBe('40')
            expect(init?.redirect).toBe('error')
            expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + 'A'.repeat(32))
            return Response.json({
                entries: [entry],
                limit: 20,
                offset: 40,
                total: 41,
                hasMore: false,
                truncated: false,
            })
        }) as unknown as typeof fetch)

        try {
            await expect(
                getProxyAccessLogs({
                    host: 'Example.COM',
                    status: 401,
                    search: 'a&b?',
                    limit: 20,
                    offset: 40,
                }),
            ).resolves.toEqual({
                entries: [entry],
                limit: 20,
                offset: 40,
                total: 41,
                hasMore: false,
                truncated: false,
            })
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('does not call a non-loopback controller without a token', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'http://controller.example:8081'
        delete process.env.RENTNERPROXY_CONTROLLER_TOKEN
        const fetchMock = spyOn(globalThis, 'fetch').mockRejectedValue(
            new Error('unexpected controller call'),
        )
        try {
            await expect(getProxyAccessLogs({})).resolves.toBeNull()
            expect(fetchMock).not.toHaveBeenCalled()
        } finally {
            fetchMock.mockRestore()
        }
    })

    test('rejects a response beyond the web transport limit', async () => {
        process.env.RENTNERPROXY_CONTROLLER_URL = 'https://controller.example:8443'
        process.env.RENTNERPROXY_CONTROLLER_TOKEN = 'B'.repeat(32)
        const fetchMock = spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('x'.repeat(PROXY_ACCESS_LOGS_MAX_RESPONSE_BYTES + 1), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        try {
            await expect(getProxyAccessLogs({})).resolves.toBeNull()
        } finally {
            fetchMock.mockRestore()
        }
    })
})

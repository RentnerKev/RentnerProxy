import { describe, expect, test } from 'bun:test'

import {
    AUTH_RATE_LIMITS,
    LOGIN_MFA_USER_RATE_LIMIT,
    RateLimitError,
    RateLimitUnavailableError,
    consumeRateLimit,
    createRateLimitKey,
    createUserRateLimitKey,
    enforceAuthRateLimit,
    enforceLoginMfaRateLimit,
    getClientIp,
} from '../server/redis/rate-limiter.service'
import type { RedisCommandClient } from '../server/redis/Types/redis.types'

function createClient(send: RedisCommandClient['send']): RedisCommandClient {
    return {
        ping: async () => 'PONG',
        send,
    }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise
        return null
    } catch (error) {
        return error
    }
}

describe('consumeRateLimit', () => {
    test('uses one atomic EVAL and returns the count and fixed-window TTL', async () => {
        const calls: Array<Readonly<{ args: string[]; command: string }>> = []
        const client = createClient((command, args) => {
            calls.push({ args, command })
            return Promise.resolve([2, 345_000])
        })

        const result = await consumeRateLimit(
            {
                identifier: 'Person@example.com',
                limit: 8,
                scope: 'login-email',
                windowMs: 600_000,
            },
            { getClient: () => client },
        )

        expect(result).toEqual({ count: 2, limit: 8, remaining: 6, ttlMs: 345_000 })
        expect(calls).toHaveLength(1)
        expect(calls[0]?.command).toBe('EVAL')
        expect(calls[0]?.args[0]).toContain("redis.call('INCR', KEYS[1])")
        expect(calls[0]?.args[0]).toContain("redis.call('PEXPIRE', KEYS[1], ARGV[1])")
        expect(calls[0]?.args[1]).toBe('1')
        expect(calls[0]?.args[3]).toBe('600000')
        expect(calls[0]?.args.join(' ')).not.toContain('Person@example.com')
        expect(calls[0]?.args[2]).toMatch(/^rentnerproxy:auth-rate-limit:login-email:[a-f0-9]{64}$/)
    })

    test('throws a typed limit error after the atomic increment exceeds the policy', async () => {
        const client = createClient(() => Promise.resolve([9, 120_000]))
        const error = await captureError(
            consumeRateLimit(
                {
                    identifier: 'person@example.com',
                    limit: 8,
                    scope: 'login-email',
                    windowMs: 600_000,
                },
                { getClient: () => client },
            ),
        )

        expect(error).toBeInstanceOf(RateLimitError)
        expect(error).toMatchObject({
            code: 'RATE_LIMITED',
            count: 9,
            limit: 8,
            retryAfterMs: 120_000,
            scope: 'login-email',
        })
    })

    test('fails closed for missing Redis, outages, and malformed responses', async () => {
        const missingError = await captureError(
            consumeRateLimit(
                { identifier: 'value', limit: 1, scope: 'login-ip', windowMs: 1_000 },
                { getClient: () => null },
            ),
        )
        expect(missingError).toBeInstanceOf(RateLimitUnavailableError)
        expect(missingError).toMatchObject({ reason: 'invalid_configuration' })

        const outageClient = createClient(() => Promise.reject(new Error('connection refused')))
        const outageError = await captureError(
            consumeRateLimit(
                { identifier: 'value', limit: 1, scope: 'login-ip', windowMs: 1_000 },
                { getClient: () => outageClient },
            ),
        )
        expect(outageError).toBeInstanceOf(RateLimitUnavailableError)
        expect(outageError).toMatchObject({ reason: 'request_failed' })

        const malformedClient = createClient(() => Promise.resolve(['1', -1]))
        const malformedError = await captureError(
            consumeRateLimit(
                { identifier: 'value', limit: 1, scope: 'login-ip', windowMs: 1_000 },
                { getClient: () => malformedClient },
            ),
        )
        expect(malformedError).toBeInstanceOf(RateLimitUnavailableError)
        expect(malformedError).toMatchObject({ reason: 'invalid_response' })
    })
})

describe('enforceAuthRateLimit', () => {
    test('centralizes login/setup/reset/invite policies', () => {
        expect(AUTH_RATE_LIMITS.login).toEqual({
            ip: { limit: 20, scope: 'login-ip', windowMs: 600_000 },
            email: { limit: 8, scope: 'login-email', windowMs: 600_000 },
        })
        expect(Object.keys(AUTH_RATE_LIMITS).toSorted()).toEqual([
            'invite',
            'login',
            'reset',
            'setup',
        ])
    })

    test('ignores forged forwarded headers and applies unknown-IP plus hashed email keys', async () => {
        const keys: string[] = []
        const warnings: string[] = []
        const client = createClient((_command, args) => {
            const key = args[2]

            if (key) {
                keys.push(key)
            }

            return Promise.resolve([1, 600_000])
        })
        const request = new Request('http://127.0.0.1/login', {
            headers: {
                forwarded: 'for=198.51.100.8',
                'x-forwarded-for': '198.51.100.9',
                'x-real-ip': '198.51.100.10',
            },
        })

        expect(getClientIp(request)).toBe('unknown')
        await enforceAuthRateLimit(
            { action: 'login', email: 'Person@example.com', request },
            {
                getClient: () => client,
                warn: (reason) => warnings.push(reason),
            },
        )

        expect(keys).toHaveLength(2)
        expect(keys.join(' ')).not.toContain('Person@example.com')
        expect(keys.join(' ')).not.toContain('198.51.100')
        expect(keys.every((key) => /^[a-z0-9:-]+$/.test(key))).toBeTrue()
        expect(warnings).toEqual(['client IP unavailable; applying unknown-IP and email limits'])
    })

    test('accepts only a verified IP supplied by an explicit resolver', async () => {
        const warnings: string[] = []
        const client = createClient(() => Promise.resolve([1, 600_000]))

        await enforceAuthRateLimit(
            {
                action: 'reset',
                email: 'person@example.com',
                request: new Request('http://127.0.0.1/reset'),
            },
            {
                getClient: () => client,
                resolveClientIp: () => '203.0.113.7',
                warn: (reason) => warnings.push(reason),
            },
        )

        expect(warnings).toEqual([])
    })

    test('falls back to the unknown-IP bucket when peer address resolution fails', async () => {
        const warnings: string[] = []
        const client = createClient(() => Promise.resolve([1, 600_000]))

        await enforceAuthRateLimit(
            {
                action: 'setup',
                email: 'person@example.com',
                request: new Request('http://127.0.0.1/setup'),
            },
            {
                getClient: () => client,
                resolveClientIp: () => {
                    throw new Error('peer address unavailable')
                },
                warn: (reason) => warnings.push(reason),
            },
        )

        expect(warnings).toEqual(['client IP unavailable; applying unknown-IP and email limits'])
    })
})

describe('enforceLoginMfaRateLimit', () => {
    const userId = '019b85a0-7c29-7000-8abc-0123456789ab'

    test('keeps the hashed IP bucket and uses a normalized UUID in a separate user bucket', async () => {
        const calls: Array<Readonly<{ args: string[]; command: string }>> = []
        const warnings: string[] = []
        const client = createClient((command, args) => {
            calls.push({ args, command })
            return Promise.resolve([1, 600_000])
        })

        const result = await enforceLoginMfaRateLimit(
            {
                request: new Request('http://127.0.0.1/login/two-factor'),
                userId: ` ${userId.toUpperCase()} `,
            },
            {
                getClient: () => client,
                resolveClientIp: () => '203.0.113.7',
                warn: (reason) => warnings.push(reason),
            },
        )

        expect(LOGIN_MFA_USER_RATE_LIMIT).toEqual({
            limit: 8,
            scope: 'login-user',
            windowMs: 600_000,
        })
        expect(calls.map((call) => call.args[2]).toSorted()).toEqual(
            [
                createRateLimitKey('login-ip', '203.0.113.7'),
                `rentnerproxy:auth-rate-limit:login-user:${userId}`,
            ].toSorted(),
        )
        expect(
            calls.every((call) => call.command === 'EVAL' && call.args[3] === '600000'),
        ).toBeTrue()
        expect(result.ip).toMatchObject({ count: 1, limit: 20, remaining: 19 })
        expect(result.user).toMatchObject({ count: 1, limit: 8, remaining: 7 })
        expect(warnings).toEqual([])
    })

    test.each(['', 'user-1', 'person@example.com', `${userId}:other`])(
        'rejects invalid user ID %s before issuing any Redis command',
        async (invalidUserId) => {
            const calls: string[] = []
            const client = createClient((command) => {
                calls.push(command)
                return Promise.resolve([1, 600_000])
            })
            const error = await captureError(
                enforceLoginMfaRateLimit(
                    {
                        request: new Request('http://127.0.0.1/login/two-factor'),
                        userId: invalidUserId,
                    },
                    { getClient: () => client, resolveClientIp: () => '203.0.113.7' },
                ),
            )

            expect(error).toBeInstanceOf(RateLimitUnavailableError)
            expect(error).toMatchObject({ reason: 'invalid_policy' })
            expect(calls).toEqual([])
        },
    )

    test('rejects unsafe scopes for UUID keys', () => {
        expect(() => createUserRateLimitKey('login-user:other', userId)).toThrow(
            RateLimitUnavailableError,
        )
    })

    test('ignores forwarded headers and retains the unknown-IP fallback', async () => {
        const keys: string[] = []
        const warnings: string[] = []
        const client = createClient((_command, args) => {
            if (args[2]) keys.push(args[2])
            return Promise.resolve([1, 600_000])
        })
        await enforceLoginMfaRateLimit(
            {
                request: new Request('http://127.0.0.1/login/two-factor', {
                    headers: { 'x-forwarded-for': '198.51.100.8' },
                }),
                userId,
            },
            { getClient: () => client, warn: (reason) => warnings.push(reason) },
        )

        expect(keys).toContain(createRateLimitKey('login-ip', 'unknown'))
        expect(keys).toContain(createUserRateLimitKey('login-user', userId))
        expect(keys.join(' ')).not.toContain('198.51.100.8')
        expect(warnings).toEqual(['client IP unavailable; applying unknown-IP and user limits'])
    })

    test('keeps one per-user limit across different client IPs', async () => {
        const counts = new Map<string, number>()
        const client = createClient((_command, args) => {
            const key = args[2] ?? ''
            const count = (counts.get(key) ?? 0) + 1
            counts.set(key, count)
            return Promise.resolve([count, 600_000])
        })
        const outcomes = await Promise.allSettled(
            Array.from({ length: 9 }, (_, index) =>
                enforceLoginMfaRateLimit(
                    { request: new Request('http://127.0.0.1/login/two-factor'), userId },
                    { getClient: () => client, resolveClientIp: () => `203.0.113.${index + 1}` },
                ),
            ),
        )
        const failures = outcomes.filter(
            (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
        )

        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(8)
        expect(failures).toHaveLength(1)
        expect(failures[0]?.reason).toBeInstanceOf(RateLimitError)
        expect(failures[0]?.reason).toMatchObject({ count: 9, limit: 8, scope: 'login-user' })
        expect(counts.get(createUserRateLimitKey('login-user', userId))).toBe(9)
    })

    test('still blocks an exhausted IP bucket', async () => {
        const client = createClient((_command, args) =>
            Promise.resolve([args[2]?.includes(':login-ip:') ? 21 : 1, 120_000]),
        )
        const error = await captureError(
            enforceLoginMfaRateLimit(
                { request: new Request('http://127.0.0.1/login/two-factor'), userId },
                { getClient: () => client, resolveClientIp: () => '203.0.113.7' },
            ),
        )

        expect(error).toBeInstanceOf(RateLimitError)
        expect(error).toMatchObject({
            count: 21,
            limit: 20,
            retryAfterMs: 120_000,
            scope: 'login-ip',
        })
    })
})

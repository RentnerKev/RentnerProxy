import { describe, expect, test } from 'bun:test'

import {
    AUTH_RATE_LIMITS,
    RateLimitError,
    RateLimitUnavailableError,
    consumeRateLimit,
    enforceAuthRateLimit,
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

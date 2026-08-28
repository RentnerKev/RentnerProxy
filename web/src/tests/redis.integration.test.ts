import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { getRedisUrl } from '../server/env.server'
import { closeRedisClient, getRedisClient } from '../server/redis/client.server'
import { checkRedisHealth } from '../server/redis/health.server'
import {
    RateLimitError,
    consumeRateLimit,
    createRateLimitKey,
    type RateLimitRequest,
    type RateLimitResult,
} from '../server/redis/rate-limiter.service'

const REDIS_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_REDIS_INTEGRATION === '1' && getRedisUrl() !== null
const integrationTest = REDIS_INTEGRATION_ENABLED ? test : test.skip
const createdKeys = new Set<string>()

function createRequest(input: { limit: number; windowMs: number }): RateLimitRequest {
    const request = {
        identifier: `integration-${randomUUID()}`,
        limit: input.limit,
        scope: 'integration',
        windowMs: input.windowMs,
    }

    createdKeys.add(createRateLimitKey(request.scope, request.identifier))
    return request
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise
        return null
    } catch (error) {
        return error
    }
}

async function cleanRedisKeys(): Promise<void> {
    if (createdKeys.size === 0) {
        return
    }

    const client = getRedisClient()

    if (!client) {
        throw new Error('Redis integration client is unavailable during cleanup.')
    }

    try {
        await client.send('DEL', [...createdKeys])
    } finally {
        createdKeys.clear()
    }
}

beforeAll(() => {
    if (!REDIS_INTEGRATION_ENABLED) {
        return
    }

    if (!getRedisClient()) {
        throw new Error('Redis integration client is unavailable.')
    }
})

afterEach(async () => {
    if (REDIS_INTEGRATION_ENABLED) {
        await cleanRedisKeys()
    }
})

afterAll(async () => {
    if (!REDIS_INTEGRATION_ENABLED) {
        return
    }

    try {
        await cleanRedisKeys()
    } finally {
        closeRedisClient()
    }
})

describe('Redis integration', () => {
    integrationTest('reports real Redis health', async () => {
        expect(await checkRedisHealth()).toEqual({ state: 'connected' })
    })

    integrationTest('atomically admits only the configured concurrent limit', async () => {
        const limit = 20
        const attempts = 40
        const request = createRequest({ limit, windowMs: 10_000 })
        const outcomes = await Promise.allSettled(
            Array.from({ length: attempts }, () => consumeRateLimit(request)),
        )
        const successful = outcomes.filter(
            (outcome): outcome is PromiseFulfilledResult<RateLimitResult> =>
                outcome.status === 'fulfilled',
        )
        const rejected = outcomes.filter(
            (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
        )
        const limitErrors = rejected
            .map((outcome) => outcome.reason)
            .filter((error): error is RateLimitError => error instanceof RateLimitError)

        expect(successful).toHaveLength(limit)
        expect(rejected).toHaveLength(attempts - limit)
        expect(limitErrors).toHaveLength(attempts - limit)
        expect(successful.map((outcome) => outcome.value.count).toSorted((a, b) => a - b)).toEqual(
            Array.from({ length: limit }, (_, index) => index + 1),
        )
        expect(limitErrors.map((error) => error.count).toSorted((a, b) => a - b)).toEqual(
            Array.from({ length: attempts - limit }, (_, index) => limit + index + 1),
        )
        expect(successful.every((outcome) => outcome.value.ttlMs > 0)).toBeTrue()
    })

    integrationTest('preserves the fixed-window TTL and returns a typed limit error', async () => {
        const windowMs = 5_000
        const request = createRequest({ limit: 1, windowMs })
        const first = await consumeRateLimit(request)

        await Bun.sleep(25)
        const error = await captureError(consumeRateLimit(request))
        const client = getRedisClient()

        if (!client) {
            throw new Error('Redis integration client is unavailable.')
        }

        const key = createRateLimitKey(request.scope, request.identifier)
        const persistedTtl = await client.send('PTTL', [key])

        expect(first).toMatchObject({ count: 1, limit: 1, remaining: 0 })
        expect(first.ttlMs).toBeGreaterThan(0)
        expect(first.ttlMs).toBeLessThanOrEqual(windowMs)
        expect(error).toBeInstanceOf(RateLimitError)
        expect(error).toMatchObject({
            code: 'RATE_LIMITED',
            count: 2,
            limit: 1,
            scope: request.scope,
        })
        expect(typeof persistedTtl).toBe('number')

        if (typeof persistedTtl !== 'number') {
            throw new Error('Redis PTTL did not return a number.')
        }

        expect(persistedTtl).toBeGreaterThan(0)
        expect(persistedTtl).toBeLessThan(first.ttlMs)
    })
})

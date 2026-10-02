import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { getValkeyUrl } from '@/server/env.server.ts'
import { closeValkeyClient, getValkeyClient } from '@/server/valkey/client.server.ts'
import { checkValkeyHealth } from '@/server/valkey/health.server.ts'
import {
    acquireCodeChallengeVerification,
    consumeCodeChallengeVerification,
    consumeAuthChallenge,
    createAuthChallenge,
    failCodeChallengeVerification,
    getAuthChallenge,
} from '@/server/valkey/auth-challenges.service.ts'
import {
    RateLimitError,
    consumeRateLimit,
    createRateLimitKey,
    type RateLimitRequest,
    type RateLimitResult,
} from '@/server/valkey/rate-limiter.service.ts'

const VALKEY_INTEGRATION_ENABLED =
    process.env.RENTNERPROXY_VALKEY_INTEGRATION === '1' && getValkeyUrl() !== null
const integrationTest = VALKEY_INTEGRATION_ENABLED ? test : test.skip
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

async function cleanValkeyKeys(): Promise<void> {
    if (createdKeys.size === 0) {
        return
    }

    const client = getValkeyClient()

    if (!client) {
        throw new Error('Valkey integration client is unavailable during cleanup.')
    }

    try {
        await client.send('DEL', [...createdKeys])
    } finally {
        createdKeys.clear()
    }
}

beforeAll(() => {
    if (!VALKEY_INTEGRATION_ENABLED) {
        return
    }

    if (!getValkeyClient()) {
        throw new Error('Valkey integration client is unavailable.')
    }
})

afterEach(async () => {
    if (VALKEY_INTEGRATION_ENABLED) {
        await cleanValkeyKeys()
    }
})

afterAll(async () => {
    if (!VALKEY_INTEGRATION_ENABLED) {
        return
    }

    try {
        await cleanValkeyKeys()
    } finally {
        closeValkeyClient()
    }
})

describe('Valkey integration', () => {
    integrationTest('recovers its cached client after a server-side disconnect', async () => {
        const disconnected = getValkeyClient()
        if (!disconnected) throw new Error('Valkey integration client is unavailable.')
        const connectionId = await disconnected.send('CLIENT', ['ID'])
        const control = await disconnected.duplicate()
        try {
            expect(await control.send('CLIENT', ['KILL', 'ID', String(connectionId)])).toBe(1)
            const deadline = Date.now() + 2_000
            let recoveredConnectionId = connectionId
            // oxlint-disable no-await-in-loop -- Recovery probes wait for the killed connection to reconnect.
            while (recoveredConnectionId === connectionId && Date.now() < deadline) {
                const client = getValkeyClient()
                if (client) {
                    try {
                        recoveredConnectionId = await client.send('CLIENT', ['ID'])
                    } catch {}
                }
                if (recoveredConnectionId === connectionId) {
                    await Bun.sleep(20)
                }
            }
            // oxlint-enable no-await-in-loop
            expect(recoveredConnectionId).not.toBe(connectionId)
            expect(await getValkeyClient()?.ping()).toBe('PONG')
        } finally {
            control.close()
        }
    })

    integrationTest(
        'publishes to a dedicated subscriber and recreates closed clients',
        async () => {
            const publisher = getValkeyClient()
            if (!publisher) throw new Error('Valkey integration client is unavailable.')
            const subscriber = await publisher.duplicate()
            const channel = `rentnerproxy:integration:${randomUUID()}`
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
                const received = new Promise<string>((resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error('Valkey PubSub timed out.')), 2_000)
                    void subscriber
                        .subscribe(channel, resolve)
                        .then(() => {
                            return publisher.publish(channel, 'isolated-integration-event')
                        })
                        .catch(reject)
                })
                expect(await received).toBe('isolated-integration-event')
            } finally {
                clearTimeout(timeout)
                subscriber.close()
            }
            closeValkeyClient()
            const reconnected = getValkeyClient()
            expect(reconnected).not.toBe(publisher)
            expect(await reconnected?.ping()).toBe('PONG')
        },
    )

    integrationTest(
        'serializes MFA verification and preserves challenge TTL through Lua updates',
        async () => {
            const issued = await createAuthChallenge(
                {
                    kind: 'login-mfa',
                    userId: randomUUID(),
                    attempts: 0,
                    createdAt: new Date().toISOString(),
                },
                2_000,
            )
            const client = getValkeyClient()
            if (!client) throw new Error('Valkey integration client is unavailable.')
            const key = `rentnerproxy:auth-challenge:login-mfa:${issued.id}`
            createdKeys.add(key)
            createdKeys.add(`rentnerproxy:auth-challenge:verification-lock:login-mfa:${issued.id}`)
            const initialTtl = await client.send('PTTL', [key])
            await Bun.sleep(25)
            const attempts = await Promise.all(
                Array.from({ length: 8 }, () =>
                    acquireCodeChallengeVerification('login-mfa', issued.id),
                ),
            )
            const acquired = attempts.filter((attempt) => attempt !== null)
            expect(acquired).toHaveLength(1)
            const verification = acquired[0]
            if (!verification) throw new Error('Valkey verification lock was not acquired.')
            expect(
                await failCodeChallengeVerification({ ...verification, kind: 'login-mfa' }),
            ).toBe('invalid')
            const updatedTtl = await client.send('PTTL', [key])
            expect(typeof initialTtl).toBe('number')
            expect(typeof updatedTtl).toBe('number')
            if (typeof initialTtl !== 'number' || typeof updatedTtl !== 'number') {
                throw new Error('Valkey PTTL did not return a number.')
            }
            expect(updatedTtl).toBeGreaterThan(0)
            expect(updatedTtl).toBeLessThan(initialTtl)
            expect(await getAuthChallenge('login-mfa', issued.id)).toMatchObject({ attempts: 1 })
            const retry = await acquireCodeChallengeVerification('login-mfa', issued.id)
            if (!retry) throw new Error('Valkey verification lock was not released.')
            const consumed = await Promise.all(
                Array.from({ length: 8 }, () =>
                    consumeCodeChallengeVerification({ ...retry, kind: 'login-mfa' }),
                ),
            )
            expect(consumed.filter((challenge) => challenge !== null)).toHaveLength(1)
            expect(await getAuthChallenge('login-mfa', issued.id)).toBeNull()
        },
    )
    integrationTest('reports real Valkey health', async () => {
        expect(await checkValkeyHealth()).toEqual({ state: 'connected' })
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
        const client = getValkeyClient()

        if (!client) {
            throw new Error('Valkey integration client is unavailable.')
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
            throw new Error('Valkey PTTL did not return a number.')
        }

        expect(persistedTtl).toBeGreaterThan(0)
        expect(persistedTtl).toBeLessThan(first.ttlMs)
    })

    integrationTest(
        'persists expiring auth challenges and consumes them exactly once',
        async () => {
            const startedAt = Date.now()
            const issued = await createAuthChallenge(
                {
                    challenge: 'valkey-integration-challenge',
                    createdAt: new Date().toISOString(),
                    kind: 'webauthn-authentication',
                },
                2_000,
            )

            expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 1_900)
            expect(await getAuthChallenge('webauthn-authentication', issued.id)).toMatchObject({
                challenge: 'valkey-integration-challenge',
                kind: 'webauthn-authentication',
            })
            expect(await consumeAuthChallenge('webauthn-authentication', issued.id)).toMatchObject({
                challenge: 'valkey-integration-challenge',
            })
            expect(await consumeAuthChallenge('webauthn-authentication', issued.id)).toBeNull()
        },
    )

    integrationTest('expires auth challenges using their Valkey TTL', async () => {
        const issued = await createAuthChallenge(
            {
                challenge: 'short-lived-integration-challenge',
                createdAt: new Date().toISOString(),
                kind: 'webauthn-authentication',
            },
            75,
        )

        expect(await getAuthChallenge('webauthn-authentication', issued.id)).not.toBeNull()
        await Bun.sleep(150)
        expect(await getAuthChallenge('webauthn-authentication', issued.id)).toBeNull()
    })
})

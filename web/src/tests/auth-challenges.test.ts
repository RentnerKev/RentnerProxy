import { describe, expect, test } from 'bun:test'

import {
    acquireCodeChallengeVerification,
    consumeAuthChallenge,
    consumeCodeChallengeVerification,
    createAuthChallenge,
    failCodeChallengeVerification,
    getAuthChallenge,
    releaseCodeChallengeVerification,
    type AuthChallengeDependencies,
    type LoginMfaChallenge,
} from '../server/redis/auth-challenges.service'
import type { RedisCommandClient } from '../server/redis/Types/redis.types'

interface FakeEntry {
    expiresAt: number | null
    value: string
}

class FakeRedis implements RedisCommandClient {
    readonly calls: Array<{ args: string[]; command: string }> = []
    private readonly entries = new Map<string, FakeEntry>()

    async ping(): Promise<string> {
        return 'PONG'
    }

    async send(command: string, args: string[]): Promise<unknown> {
        this.calls.push({ args: [...args], command })

        switch (command) {
            case 'SET':
                return this.set(args)
            case 'GET':
                return this.get(args[0])
            case 'GETDEL':
                return this.getAndDelete(args[0])
            case 'EVAL':
                return this.eval(args)
            default:
                throw new Error(`Unsupported fake Redis command: ${command}`)
        }
    }

    setRaw(key: string, value: string): void {
        this.entries.set(key, { expiresAt: null, value })
    }

    private set(args: string[]): string | null {
        const [key, value, nx, px, duration] = args

        if (!key || value === undefined) {
            throw new Error('Fake SET requires a key and value.')
        }

        if (nx === 'NX' && this.getEntry(key)) {
            return null
        }

        const durationMs = px === 'PX' && duration ? Number(duration) : null
        this.entries.set(key, {
            expiresAt: durationMs === null ? null : Date.now() + durationMs,
            value,
        })
        return 'OK'
    }

    private get(key: string | undefined): string | null {
        if (!key) {
            return null
        }

        return this.getEntry(key)?.value ?? null
    }

    private getAndDelete(key: string | undefined): string | null {
        const value = this.get(key)

        if (key) {
            this.entries.delete(key)
        }

        return value
    }

    private getEntry(key: string): FakeEntry | null {
        const entry = this.entries.get(key)

        if (!entry) {
            return null
        }

        if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
            this.entries.delete(key)
            return null
        }

        return entry
    }

    private eval(args: string[]): Array<number | string> {
        const script = args[0] ?? ''
        const numberOfKeys = Number(args[1])
        const challengeKey = args[2]
        const lockKey = numberOfKeys === 2 ? args[3] : args[2]
        const lockToken = numberOfKeys === 2 ? args[4] : args[3]

        if (!challengeKey || !lockKey || !lockToken) {
            throw new Error('Fake EVAL received incomplete keys.')
        }

        if (numberOfKeys === 1) {
            if (this.get(lockKey) === lockToken) {
                this.entries.delete(lockKey)
            }
            return [1]
        }

        if (script.includes('local attempts =')) {
            return this.failVerification(challengeKey, lockKey, lockToken, Number(args[5]))
        }

        if (this.get(lockKey) !== lockToken) {
            return [0]
        }

        const value = this.get(challengeKey)

        if (value === null) {
            this.entries.delete(lockKey)
            return [1]
        }

        this.entries.delete(challengeKey)
        this.entries.delete(lockKey)
        return [2, value]
    }

    private failVerification(
        challengeKey: string,
        lockKey: string,
        lockToken: string,
        maxAttempts: number,
    ): Array<number | string> {
        if (this.get(lockKey) !== lockToken) {
            return [0]
        }

        const entry = this.getEntry(challengeKey)

        if (!entry) {
            this.entries.delete(lockKey)
            return [1]
        }

        const challenge = JSON.parse(entry.value) as { attempts?: number }
        const attempts = (challenge.attempts ?? 0) + 1

        if (attempts >= maxAttempts) {
            this.entries.delete(challengeKey)
            this.entries.delete(lockKey)
            return [3, attempts]
        }

        this.entries.set(challengeKey, {
            expiresAt: entry.expiresAt,
            value: JSON.stringify({ ...challenge, attempts }),
        })
        this.entries.delete(lockKey)
        return [2, attempts]
    }
}

const fakeRedis = new FakeRedis()
const dependencies: AuthChallengeDependencies = {
    getClient: () => fakeRedis,
}

function createLoginChallenge(): LoginMfaChallenge {
    return {
        attempts: 0,
        createdAt: new Date().toISOString(),
        kind: 'login-mfa',
        userId: 'user-1',
    }
}

describe('authentication challenge storage', () => {
    test('creates challenges with NX and PX and supports peek plus one-use consumption', async () => {
        fakeRedis.calls.length = 0
        const issued = await createAuthChallenge(createLoginChallenge(), 300_000, dependencies)
        const setCall = fakeRedis.calls.find((call) => call.command === 'SET')

        expect(setCall?.args.slice(-2)).toEqual(['PX', '300000'])
        expect(setCall?.args).toContain('NX')

        expect(await getAuthChallenge('login-mfa', issued.id, dependencies)).toMatchObject({
            kind: 'login-mfa',
            userId: 'user-1',
        })
        expect(await consumeAuthChallenge('login-mfa', issued.id, dependencies)).toMatchObject({
            kind: 'login-mfa',
            userId: 'user-1',
        })
        expect(await consumeAuthChallenge('login-mfa', issued.id, dependencies)).toBeNull()
    })

    test('locks code verification, increments attempts, and removes the challenge at the limit', async () => {
        const issued = await createAuthChallenge(createLoginChallenge(), 300_000, dependencies)
        const first = await acquireCodeChallengeVerification('login-mfa', issued.id, dependencies)

        expect(first).not.toBeNull()
        expect(
            await acquireCodeChallengeVerification('login-mfa', issued.id, dependencies),
        ).toBeNull()

        if (!first) {
            throw new Error('The first verification lock was not acquired.')
        }

        expect(
            await failCodeChallengeVerification({ ...first, kind: 'login-mfa' }, dependencies),
        ).toBe('invalid')

        for (let attempt = 2; attempt <= 5; attempt += 1) {
            // oxlint-disable eslint/no-await-in-loop -- Each attempt must observe the previous atomic Redis mutation.
            const verification = await acquireCodeChallengeVerification(
                'login-mfa',
                issued.id,
                dependencies,
            )
            expect(verification).not.toBeNull()

            if (!verification) {
                throw new Error(`Verification lock was not acquired for attempt ${attempt}.`)
            }

            const result = await failCodeChallengeVerification(
                {
                    ...verification,
                    kind: 'login-mfa',
                },
                dependencies,
            )
            expect(result).toBe(attempt === 5 ? 'locked' : 'invalid')
        }
        // oxlint-enable eslint/no-await-in-loop

        expect(await getAuthChallenge('login-mfa', issued.id, dependencies)).toBeNull()
    })

    test('consumes a challenge only while holding its verification lock', async () => {
        const issued = await createAuthChallenge(createLoginChallenge(), 300_000, dependencies)
        const verification = await acquireCodeChallengeVerification(
            'login-mfa',
            issued.id,
            dependencies,
        )

        expect(verification).not.toBeNull()

        if (!verification) {
            throw new Error('Verification lock was not acquired.')
        }

        await releaseCodeChallengeVerification({ ...verification, kind: 'login-mfa' }, dependencies)
        expect(
            await consumeCodeChallengeVerification(
                { ...verification, kind: 'login-mfa' },
                dependencies,
            ),
        ).toBeNull()
    })

    test('fails closed for malformed persisted challenge data', async () => {
        const issued = await createAuthChallenge(createLoginChallenge(), 300_000, dependencies)
        fakeRedis.setRaw(
            `rentnerproxy:auth-challenge:login-mfa:${issued.id}`,
            JSON.stringify({ attempts: 'not-a-number', kind: 'login-mfa' }),
        )

        await expect(getAuthChallenge('login-mfa', issued.id, dependencies)).rejects.toMatchObject({
            name: 'AuthChallengeStateError',
        })
    })
})

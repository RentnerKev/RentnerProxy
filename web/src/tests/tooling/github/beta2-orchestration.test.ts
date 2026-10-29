// oxlint-disable no-await-in-loop
import { describe, expect, mock, spyOn, test } from 'bun:test'
import { access, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { withPausedDdnsScheduler } from '../../../../../.github/scripts/ci/beta2/scheduler-control.ts'
import {
    beta2Directory,
    validateBeta2Environment,
} from '../../../../../.github/scripts/ci/beta2/run.ts'

const environment = {
    RENTNERPROXY_BETA2_INTEGRATION: '1',
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:5432/rentnerproxy_beta2_test',
    VALKEY_URL: 'redis://127.0.0.1:6379',
}

const pauseRequest = 'ddns-scheduler-pause-request.json'
const pauseAck = 'ddns-scheduler-paused.json'
const pauseOptions = { timeoutMs: 500, releaseTimeoutMs: 500, pollIntervalMs: 2 }

async function schedulerFixture(operation: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), 'rentnerproxy-beta2-scheduler-'))
    try {
        await operation(directory)
    } finally {
        expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
        await rm(directory, { recursive: true, force: true })
    }
}

async function eventually(check: () => Promise<boolean>) {
    const deadline = performance.now() + 1_000
    while (!(await check())) {
        if (performance.now() >= deadline) throw new Error('Scheduler test handshake timed out')
        await delay(2)
    }
}

async function exists(path: string) {
    try {
        await access(path)
        return true
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
    }
}

async function requestedNonce(directory: string) {
    const path = join(directory, pauseRequest)
    await eventually(() => exists(path))
    const input: unknown = JSON.parse(await readFile(path, 'utf8'))
    expect(input).toEqual({ nonce: expect.stringMatching(/^[a-f0-9]{32}$/u) })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    return (input as { nonce: string }).nonce
}

async function acknowledge(directory: string, nonce: string) {
    const temporary = join(directory, 'ack-temp')
    await writeFile(temporary, JSON.stringify({ nonce }), { mode: 0o600, flag: 'wx' })
    await rename(temporary, join(directory, pauseAck))
}

async function releaseAcknowledgement(directory: string) {
    await eventually(async () => !(await exists(join(directory, pauseRequest))))
    await rm(join(directory, pauseAck), { force: true })
}

describe('Beta 2 scheduler pause lease', () => {
    test('publishes a complete private request and never runs before matching acknowledgement', async () => {
        await schedulerFixture(async (directory) => {
            const operation = mock(async () => undefined)
            const pause = withPausedDdnsScheduler(directory, operation, pauseOptions)
            void pause.catch(() => undefined)
            const nonce = await requestedNonce(directory)
            const wrong = (nonce[0] === '0' ? '1' : '0') + nonce.slice(1)
            await acknowledge(directory, wrong)
            await delay(12)
            expect(operation).not.toHaveBeenCalled()
            const released = releaseAcknowledgement(directory)
            await acknowledge(directory, nonce)
            await Promise.all([pause, released])
            expect(operation).toHaveBeenCalledTimes(1)
            expect(await readdir(directory)).toEqual([])
        })
    })

    test('releases a confirmed lease before propagating the original operation error', async () => {
        await schedulerFixture(async (directory) => {
            const failure = new Error('original operation failure')
            const result = withPausedDdnsScheduler(
                directory,
                async () => {
                    throw failure
                },
                pauseOptions,
            ).catch((error: unknown) => error)
            const nonce = await requestedNonce(directory)
            const released = releaseAcknowledgement(directory)
            await acknowledge(directory, nonce)
            expect((await Promise.all([result, released]))[0]).toBe(failure)
            expect(await readdir(directory)).toEqual([])
        })
    })

    test('rejects release timeout after a successful operation when its acknowledgement remains', async () => {
        await schedulerFixture(async (directory) => {
            let entered!: () => void
            const active = new Promise<void>((resolveActive) => {
                entered = resolveActive
            })
            const operation = mock(async () => {
                entered()
            })
            const pause = withPausedDdnsScheduler(directory, operation, {
                ...pauseOptions,
                releaseTimeoutMs: 25,
            })
            void pause.catch(() => undefined)
            await acknowledge(directory, await requestedNonce(directory))
            await active
            await eventually(async () => !(await exists(join(directory, pauseRequest))))
            expect(await exists(join(directory, pauseAck))).toBe(true)
            await expect(pause).rejects.toThrow('scheduler pause release timed out')
            expect(operation).toHaveBeenCalledTimes(1)
            expect(await readdir(directory)).toEqual([pauseAck])
        })
    })

    test('holds the confirmed lease through an active operation abort and preserves its reason after release', async () => {
        await schedulerFixture(async (directory) => {
            let entered!: () => void
            let finish!: () => void
            let ended!: () => void
            const active = new Promise<void>((resolveActive) => {
                entered = resolveActive
            })
            const holding = new Promise<void>((resolveHolding) => {
                finish = resolveHolding
            })
            const completed = new Promise<void>((resolveCompleted) => {
                ended = resolveCompleted
            })
            const abort = new AbortController()
            const reason = new Error('aborted during active operation')
            let operationEnded = false
            let settled = false
            const operation = mock(async () => {
                entered()
                await holding
                operationEnded = true
                ended()
            })
            const result = withPausedDdnsScheduler(directory, operation, {
                ...pauseOptions,
                signal: abort.signal,
            }).then(
                () => ({ success: true as const }),
                (error: unknown) => ({ success: false as const, error }),
            )
            void result.then(() => {
                settled = true
            })
            await acknowledge(directory, await requestedNonce(directory))
            await active
            try {
                abort.abort(reason)
                expect(await exists(join(directory, pauseRequest))).toBe(true)
                expect(await exists(join(directory, pauseAck))).toBe(true)
                expect(operationEnded).toBe(false)
                finish()
                await completed
                await eventually(async () => !(await exists(join(directory, pauseRequest))))
                expect(settled).toBe(false)
                await rm(join(directory, pauseAck))
                const outcome = await result
                expect(outcome.success).toBe(false)
                if (outcome.success)
                    throw new Error('Aborted scheduler pause unexpectedly succeeded')
                expect(outcome.error).toBe(reason)
                expect(operation).toHaveBeenCalledTimes(1)
                expect(await readdir(directory)).toEqual([])
            } finally {
                finish()
                await rm(join(directory, pauseAck), { force: true })
                await result
            }
        })
    })

    test('preserves an operation error even if acknowledgement release stalls', async () => {
        const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            await schedulerFixture(async (directory) => {
                const failure = new Error('operation failed before release')
                const result = withPausedDdnsScheduler(
                    directory,
                    async () => {
                        throw failure
                    },
                    {
                        ...pauseOptions,
                        releaseTimeoutMs: 25,
                    },
                ).catch((error: unknown) => error)
                await acknowledge(directory, await requestedNonce(directory))
                expect(await result).toBe(failure)
                expect(await exists(join(directory, pauseRequest))).toBe(false)
                expect(await exists(join(directory, pauseAck))).toBe(true)
                expect(diagnostic).toHaveBeenCalledTimes(1)
            })
        } finally {
            diagnostic.mockRestore()
        }
    })

    test('fails closed on acquisition timeout when the controller never confirms', async () => {
        const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            await schedulerFixture(async (directory) => {
                const operation = mock(async () => undefined)
                await expect(
                    withPausedDdnsScheduler(directory, operation, {
                        timeoutMs: 20,
                        releaseTimeoutMs: 20,
                        pollIntervalMs: 2,
                    }),
                ).rejects.toThrow('pause acknowledgement timed out')
                expect(operation).not.toHaveBeenCalled()
                expect(await readdir(directory)).toEqual([pauseRequest])
                expect(diagnostic).toHaveBeenCalledTimes(1)
            })
        } finally {
            diagnostic.mockRestore()
        }
    })

    test.each([
        JSON.stringify({ nonce: 'a'.repeat(32), extra: true }),
        `{"nonce":"${'a'.repeat(32)}","nonce":"${'a'.repeat(32)}"}`,
        JSON.stringify({ nonce: 'A'.repeat(32) }),
    ])(
        'rejects malformed acknowledgement objects without running the operation: %s',
        async (acknowledgement) => {
            const diagnostic = spyOn(console, 'error').mockImplementation(() => undefined)
            try {
                await schedulerFixture(async (directory) => {
                    await writeFile(join(directory, pauseAck), acknowledgement, { mode: 0o600 })
                    const operation = mock(async () => undefined)
                    await expect(
                        withPausedDdnsScheduler(directory, operation, {
                            timeoutMs: 20,
                            releaseTimeoutMs: 20,
                            pollIntervalMs: 2,
                        }),
                    ).rejects.toThrow('Invalid Beta 2 scheduler acknowledgement')
                    expect(operation).not.toHaveBeenCalled()
                    expect(await exists(join(directory, pauseRequest))).toBe(true)
                })
            } finally {
                diagnostic.mockRestore()
            }
        },
    )

    test('waits for late acknowledgement after abort before removing the request and releasing', async () => {
        await schedulerFixture(async (directory) => {
            const abort = new AbortController()
            const reason = new Error('cancelled scheduler wait')
            const operation = mock(async () => undefined)
            const result = withPausedDdnsScheduler(directory, operation, {
                ...pauseOptions,
                signal: abort.signal,
            }).catch((error: unknown) => error)
            const nonce = await requestedNonce(directory)
            abort.abort(reason)
            await delay(8)
            expect(await exists(join(directory, pauseRequest))).toBe(true)
            expect(operation).not.toHaveBeenCalled()
            const released = releaseAcknowledgement(directory)
            await acknowledge(directory, nonce)
            expect((await Promise.all([result, released]))[0]).toBe(reason)
            expect(await readdir(directory)).toEqual([])
        })
    })

    test('does not publish anything when already aborted', async () => {
        await schedulerFixture(async (directory) => {
            const abort = new AbortController()
            const reason = new Error('already aborted')
            abort.abort(reason)
            const operation = mock(async () => undefined)
            await expect(
                withPausedDdnsScheduler(directory, operation, {
                    ...pauseOptions,
                    signal: abort.signal,
                }),
            ).rejects.toBe(reason)
            expect(operation).not.toHaveBeenCalled()
            expect(await readdir(directory)).toEqual([])
        })
    })

    test('exclusive publication cannot replace or release an active caller lease', async () => {
        await schedulerFixture(async (directory) => {
            let entered!: () => void
            let finish!: () => void
            const active = new Promise<void>((resolveEntered) => {
                entered = resolveEntered
            })
            const holding = new Promise<void>((resolveHolding) => {
                finish = resolveHolding
            })
            const first = withPausedDdnsScheduler(
                directory,
                async () => {
                    entered()
                    await holding
                },
                pauseOptions,
            )
            void first.catch(() => undefined)
            const nonce = await requestedNonce(directory)
            await acknowledge(directory, nonce)
            await active
            const released = releaseAcknowledgement(directory)
            try {
                const other = mock(async () => undefined)
                await expect(
                    withPausedDdnsScheduler(directory, other, pauseOptions),
                ).rejects.toMatchObject({ code: 'EEXIST' })
                expect(other).not.toHaveBeenCalled()
                expect(await requestedNonce(directory)).toBe(nonce)
                expect((await readdir(directory)).toSorted()).toEqual(
                    [pauseRequest, pauseAck].toSorted(),
                )
            } finally {
                finish()
                await Promise.all([first, released])
            }
            expect(await readdir(directory)).toEqual([])
        })
    })
})

describe('Beta 2 launcher mutation boundaries', () => {
    test('accepts only explicitly enabled Linux loopback fixtures', () => {
        expect(() => validateBeta2Environment(environment, 'linux')).not.toThrow()
        expect(() => validateBeta2Environment(environment, 'win32')).toThrow()
        expect(() =>
            validateBeta2Environment(
                { ...environment, RENTNERPROXY_BETA2_INTEGRATION: undefined },
                'linux',
            ),
        ).toThrow()
        expect(() =>
            validateBeta2Environment(
                { ...environment, RENTNERPROXY_BETA2_INTEGRATION: 'run-id' },
                'linux',
            ),
        ).toThrow()
    })
    test('rejects unrelated databases, remote endpoints and connection overrides', () => {
        for (const DATABASE_URL of [
            'postgresql://127.0.0.1/production',
            'postgresql://example.test/rentnerproxy_beta2_test',
            'postgresql://127.0.0.1/rentnerproxy_beta2_test?host=example.test',
            'https://127.0.0.1/rentnerproxy_beta2_test',
        ])
            expect(() =>
                validateBeta2Environment({ ...environment, DATABASE_URL }, 'linux'),
            ).toThrow()
        for (const VALKEY_URL of [
            'redis://example.test:6379',
            'redis://127.0.0.1:6379?host=example.test',
            'https://127.0.0.1',
        ])
            expect(() =>
                validateBeta2Environment({ ...environment, VALKEY_URL }, 'linux'),
            ).toThrow()
    })
    test('temporary deletion targets have one exact parent and an unforgeable run-ID shape', () => {
        expect(beta2Directory('a'.repeat(32))).toBe('/tmp/rentnerproxy-beta2-' + 'a'.repeat(32))
        for (const runId of [
            '',
            '../other',
            'a'.repeat(31),
            'a'.repeat(33),
            'A'.repeat(32),
            'a'.repeat(31) + '/',
        ])
            expect(() => beta2Directory(runId)).toThrow()
    })
})

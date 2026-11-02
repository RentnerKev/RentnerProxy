import { describe, expect, spyOn, test } from 'bun:test'
import { withUpstreamFailoverCleanup } from '../../../../../../scripts/smoke/proxy/upstream-failover.ts'
import type { UpstreamFailoverCleanup } from '../../../../../../scripts/smoke/proxy/Types/upstream-failover.types.ts'

const phases = ['restoreRuntime', 'deleteHost', 'stopPrimary', 'stopSecondary'] as const

describe('upstream failover smoke cleanup', () => {
    test('runs all cleanup actions after a successful body', async () => {
        const calls: string[] = []
        await withUpstreamFailoverCleanup(
            async () => {
                calls.push('body')
            },
            {
                restoreRuntime: () => calls.push('restoreRuntime'),
                deleteHost: () => calls.push('deleteHost'),
                stopPrimary: () => calls.push('stopPrimary'),
                stopSecondary: () => calls.push('stopSecondary'),
            },
        )
        expect(calls).toEqual(['body', ...phases])
    })

    test.each(phases.flatMap((phase) => ['sync', 'async'].map((mode) => ({ phase, mode }))))(
        'attempts every action when $phase fails $mode and rejects an otherwise successful smoke',
        async ({ phase, mode }) => {
            const calls: string[] = []
            const action = (name: keyof UpstreamFailoverCleanup) => () => {
                calls.push(name)
                if (name !== phase) return
                if (mode === 'sync') throw new Error('private fixture diagnostic')
                return Promise.reject(new Error('private fixture diagnostic'))
            }
            const cleanup: UpstreamFailoverCleanup = {
                restoreRuntime: action('restoreRuntime'),
                deleteHost: action('deleteHost'),
                stopPrimary: action('stopPrimary'),
                stopSecondary: action('stopSecondary'),
            }
            const outcome = await withUpstreamFailoverCleanup(async () => {}, cleanup).then(
                () => ({ rejected: false, error: undefined }),
                (error: unknown) => ({ rejected: true, error }),
            )
            expect(calls).toEqual([...phases])
            expect(outcome.rejected).toBe(true)
            expect(outcome.error).toBeInstanceOf(Error)
            expect((outcome.error as Error).message).toStartWith(
                'Upstream failover smoke cleanup failed: ',
            )
            expect((outcome.error as Error).message).not.toContain('private fixture diagnostic')
        },
    )

    test.each([
        { label: 'Error', original: new Error('original assertion') },
        { label: 'undefined', original: undefined },
        { label: 'null', original: null },
        { label: 'false', original: false },
        { label: 'zero', original: 0 },
    ])(
        'preserves the exact $label body rejection despite simultaneous sync and async cleanup failures',
        async ({ original }) => {
            const calls: string[] = []
            const log = spyOn(console, 'error').mockImplementation(() => {})
            try {
                const outcome = await withUpstreamFailoverCleanup(
                    async () => {
                        throw original
                    },
                    {
                        restoreRuntime: () => {
                            calls.push('restoreRuntime')
                            throw new Error('private restart failure')
                        },
                        deleteHost: async () => {
                            calls.push('deleteHost')
                            throw new Error('private deletion failure')
                        },
                        stopPrimary: () => {
                            calls.push('stopPrimary')
                            throw new Error('private primary failure')
                        },
                        stopSecondary: async () => {
                            calls.push('stopSecondary')
                            throw new Error('private secondary failure')
                        },
                    },
                ).then(
                    () => ({ rejected: false, error: undefined }),
                    (error: unknown) => ({ rejected: true, error }),
                )
                expect(calls).toEqual([...phases])
                expect(outcome.rejected).toBe(true)
                expect(outcome.error).toBe(original)
                expect(log.mock.calls).toEqual([
                    [
                        'Upstream failover smoke cleanup failed: restore-runtime, delete-host, stop-primary, stop-secondary',
                    ],
                ])
            } finally {
                log.mockRestore()
            }
        },
    )
})

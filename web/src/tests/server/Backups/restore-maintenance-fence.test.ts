import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import { createRestoreMaintenanceFence } from '@/server/Backups/restore-maintenance-fence.ts'

const token = 'a'.repeat(43)
const tokenHash = createHash('sha256').update(token).digest('hex')
const authenticated = () =>
    new Request('http://localhost/api/live-snapshot', {
        headers: { cookie: 'rentnerproxy_session=' + token },
    })

describe('restore maintenance fence', () => {
    test('drains admitted requests before quiescing and acknowledges only after quiescing', async () => {
        const response = Promise.withResolvers<Response>()
        const drained = Promise.withResolvers<void>()
        const calls: string[] = []
        const fence = createRestoreMaintenanceFence({
            now: () => 100,
            quiesce: async () => {
                calls.push('quiesce')
                await drained.promise
                return [{ tokenHash, expiresAt: new Date(1_000) }]
            },
            acknowledge: async () => {
                calls.push('ack')
            },
        })
        const admitted = fence.fetch(
            new Request('http://localhost/action', { method: 'POST' }),
            () => response.promise,
        )
        const entering = fence.enter('restore-id')
        expect(fence.isFenced()).toBe(true)
        expect(fence.authorize(authenticated())).toBe(false)
        const blocked = await fence.fetch(
            new Request('http://localhost/action', { method: 'POST' }),
            async () => {
                throw new Error('mutation must not run')
            },
        )
        expect(blocked.status).toBe(503)
        expect(calls).toEqual([])
        response.resolve(new Response('done'))
        await admitted
        await Promise.resolve()
        expect(calls).toEqual(['quiesce'])
        drained.resolve()
        await entering
        expect(calls).toEqual(['quiesce', 'ack'])
        expect(fence.authorize(authenticated())).toBe(true)
        expect(
            (await fence.fetch(authenticated(), async () => new Response('snapshot'))).status,
        ).toBe(200)
        expect(
            (
                await fence.fetch(
                    new Request('http://localhost/api/live-snapshot', { method: 'POST' }),
                    async () => new Response(),
                )
            ).status,
        ).toBe(503)
        await fence.enter('restore-id')
        expect(calls).toEqual(['quiesce', 'ack'])
        await expect(fence.enter('other-restore')).rejects.toThrow('already entered')
    })

    test('requires one valid pre-restore token and expires maintenance access without extending sessions', async () => {
        let now = 100
        const fence = createRestoreMaintenanceFence({
            now: () => now,
            quiesce: async () => [{ tokenHash, expiresAt: new Date(200) }],
            acknowledge: async () => undefined,
        })
        await fence.enter('restore')
        expect(fence.authorize(authenticated())).toBe(true)
        for (const cookie of [
            '',
            'rentnerproxy_session=wrong',
            `rentnerproxy_session=${token};rentnerproxy_session=${token}`,
        ]) {
            expect(fence.authorize(new Request('http://localhost', { headers: { cookie } }))).toBe(
                false,
            )
        }
        now = 200
        expect(fence.authorize(authenticated())).toBe(false)
    })

    test('caps cached authentication to one hour even for a long-lived session', async () => {
        let now = 100
        const fence = createRestoreMaintenanceFence({
            now: () => now,
            quiesce: async () => [{ tokenHash, expiresAt: new Date(86_400_000) }],
            acknowledge: async () => undefined,
        })
        await fence.enter('restore')
        now += 3_600_000
        expect(fence.authorize(authenticated())).toBe(false)
    })

    test('a failed drain never acknowledges readiness or grants temporary access', async () => {
        let acknowledgements = 0
        const fence = createRestoreMaintenanceFence({
            quiesce: async () => {
                throw new Error('worker still running')
            },
            acknowledge: async () => {
                acknowledgements += 1
            },
        })
        await expect(fence.enter('restore')).rejects.toThrow('worker still running')
        expect(acknowledgements).toBe(0)
        expect(fence.authorize(authenticated())).toBe(false)
        expect(fence.isFenced()).toBe(true)
    })

    test('bootstrap completion clears temporary access before allowing the restored application', async () => {
        const fence = createRestoreMaintenanceFence({
            quiesce: async () => [{ tokenHash, expiresAt: new Date(Date.now() + 60_000) }],
            acknowledge: async () => undefined,
        })
        await fence.enter('restore')
        expect(fence.authorize(authenticated())).toBe(true)
        fence.release()
        expect(fence.authorize(authenticated())).toBe(false)
        expect(fence.isFenced()).toBe(false)
        expect(
            (
                await fence.fetch(
                    new Request('http://localhost/action', { method: 'POST' }),
                    async () => new Response('restored'),
                )
            ).status,
        ).toBe(200)
    })

    test('never acknowledges a session cache exceeding its bound', async () => {
        let acknowledged = false
        const fence = createRestoreMaintenanceFence({
            quiesce: async () =>
                Array.from({ length: 10_001 }, () => ({
                    tokenHash,
                    expiresAt: new Date(Date.now() + 60_000),
                })),
            acknowledge: async () => {
                acknowledged = true
            },
        })
        await expect(fence.enter('restore')).rejects.toThrow('Too many maintenance sessions')
        expect(acknowledged).toBe(false)
        expect(fence.authorize(authenticated())).toBe(false)
    })

    test('a revocation already admitted before the restore queue is reflected before acknowledgement', async () => {
        const mutation = Promise.withResolvers<Response>()
        const order: Array<string> = []
        let revoked = false
        let visibleWhenAcknowledged = true
        const fence = createRestoreMaintenanceFence({
            quiesce: async () => {
                order.push('snapshot-current-sessions')
                return revoked ? [] : [{ tokenHash, expiresAt: new Date(Date.now() + 60_000) }]
            },
            acknowledge: async () => {
                visibleWhenAcknowledged = fence.authorize(authenticated())
                order.push('acknowledge')
            },
        })
        const admitted = fence.fetch(
            new Request('http://localhost/revoke-session', { method: 'POST' }),
            async () => {
                const response = await mutation.promise
                revoked = true
                order.push('revocation-committed')
                return response
            },
        )
        const entering = fence.enter('restore')
        expect(order).toEqual([])
        mutation.resolve(new Response(null, { status: 204 }))
        await Promise.all([admitted, entering])
        expect(order).toEqual(['revocation-committed', 'snapshot-current-sessions', 'acknowledge'])
        expect(visibleWhenAcknowledged).toBe(false)
        expect(fence.authorize(authenticated())).toBe(false)
    })
})

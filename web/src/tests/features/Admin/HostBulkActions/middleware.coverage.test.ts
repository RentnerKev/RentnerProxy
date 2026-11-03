import { beforeEach, describe, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'

const boundary = createMiddlewareHarness()
const names = ['previewBulkService', 'applyBulkService']
boundary.mockServices('@/server/Admin/HostBulkActions/bulk-hosts.storage.server.ts', [], {
    bulkHostServices: {
        preview: async (input: unknown) => {
            boundary.calls.push({ name: names[0]!, arguments: [input] })
            if (boundary.failures.has(names[0]!)) throw boundary.failures.get(names[0]!)
            return boundary.values.get(names[0]!)
        },
        apply: async (input: unknown) => {
            boundary.calls.push({ name: names[1]!, arguments: [input] })
            if (boundary.failures.has(names[1]!)) throw boundary.failures.get(names[1]!)
            return boundary.values.get(names[1]!)
        },
    },
})
const handlers = await import('@/features/Admin/HostBulkActions/middleware.ts')
const id = '0198d98a-0000-7000-8000-000000000881'
beforeEach(() => boundary.reset())

describe('bulk host action boundary', () => {
    test.each([
        [
            handlers.previewBulkHostsHandler,
            names[0]!,
            { kind: 'proxy', action: { type: 'disable' }, hostIds: [id] },
        ],
        [
            handlers.applyBulkHostsHandler,
            names[1]!,
            {
                kind: 'proxy',
                action: { type: 'disable' },
                hosts: [{ id, version: 'a'.repeat(64) }],
            },
        ],
    ])(
        'binds %s to validated host versions and keeps result/error responses private',
        async (handler, service, input) => {
            boundary.values.set(service, { eligible: 1 })
            expect(await boundary.invoke(handler, input)).toEqual({
                success: true,
                value: { eligible: 1 },
            })
            expect(boundary.argumentsFor(service)).toEqual([[input]])
            expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
            boundary.failures.set(service, new Error('private host fixture detail'))
            expect(await boundary.invoke(handler, input)).toEqual({
                success: false,
                message: 'admin.bulkHosts.error',
            })
        },
    )

    test('rejects duplicate preview IDs and tampered apply versions before reaching storage', async () => {
        await expect(
            boundary.invoke(handlers.previewBulkHostsHandler, {
                kind: 'proxy',
                action: { type: 'disable' },
                hostIds: [id, id],
            }),
        ).rejects.toThrow()
        await expect(
            boundary.invoke(handlers.applyBulkHostsHandler, {
                kind: 'proxy',
                action: { type: 'disable' },
                hosts: [{ id, version: 'invalid' }],
            }),
        ).rejects.toThrow()
        expect(boundary.calls).toEqual([])
    })
})

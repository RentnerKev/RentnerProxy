import { beforeEach, describe, expect, test } from 'bun:test'
import { createMiddlewareHarness } from '@/tests/Helpers/middlewareCoverage.ts'
import { HostTagDomainError } from '@/lib/HostTags/hostTags.ts'

const boundary = createMiddlewareHarness()
boundary.mockServices('@/server/Admin/HostTags/host-tags.service.ts', [
    'getHostTagCatalogService',
    'mutateHostTagService',
])
const handlers = await import('@/features/Admin/HostTags/middleware.ts')
beforeEach(() => boundary.reset())

describe('host tag request boundary', () => {
    test('validates host kinds and keeps catalog responses private', async () => {
        boundary.values.set('getHostTagCatalogService', { revision: 1, tags: [] })
        expect(await boundary.invoke(handlers.getHostTagCatalogHandler, 'proxy')).toEqual({
            revision: 1,
            tags: [],
        })
        expect(boundary.argumentsFor('getHostTagCatalogService')).toEqual([['proxy']])
        expect(boundary.headers.get('Cache-Control')).toBe('private, no-store')
        await expect(boundary.invoke(handlers.getHostTagCatalogHandler, 'other')).rejects.toThrow()
        boundary.failures.set('getHostTagCatalogService', new Error('private fixture detail'))
        await expect(boundary.invoke(handlers.getHostTagCatalogHandler, 'proxy')).rejects.toThrow(
            'admin.hostTags.errors.loadFailed',
        )
    })

    test('preserves domain conflict messages and sanitizes unexpected failures', async () => {
        const input = { kind: 'proxy', expectedRevision: 1, action: 'create', name: 'Fixture' }
        boundary.values.set('mutateHostTagService', { revision: 2 })
        expect(await boundary.invoke(handlers.mutateHostTagHandler, input)).toEqual({
            success: true,
            value: { revision: 2 },
        })
        boundary.failures.set('mutateHostTagService', new HostTagDomainError('conflict'))
        expect(await boundary.invoke(handlers.mutateHostTagHandler, input)).toMatchObject({
            success: false,
        })
        boundary.failures.set('mutateHostTagService', new Error('private fixture detail'))
        expect(await boundary.invoke(handlers.mutateHostTagHandler, input)).toEqual({
            success: false,
            message: 'admin.hostTags.errors.saveFailed',
        })
    })
})

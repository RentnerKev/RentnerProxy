import { describe, expect, mock, test } from 'bun:test'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { AuthTransaction } from '@/server/Auth/Core/Types/database.types.ts'
import { createHostPageReader } from '@/server/Admin/HostTags/host-page-reader.server.ts'
import type { HostListEntry, HostKind } from '@/lib/HostTags/Types/host-tags.types.ts'
import { LANGUAGE_RESOURCE_LOADERS } from '@/lib/Language/resources.ts'
import { hostListQuerySchema } from '@/features/Admin/HostTags/validation.ts'
import { filterHostPage } from '@/lib/HostTags/hostList.ts'
import { tagsForHost } from '@/lib/HostTags/hostTags.ts'

const tag = { id: '00000000-0000-4000-8000-000000000001', name: 'Büro' }
const otherTag = { id: '00000000-0000-4000-8000-000000000002', name: 'Étage' }

function setup(kind: HostKind) {
    const transaction = {} as AuthTransaction
    const basis: HostListEntry[] = Array.from({ length: 25 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
        domains: [`app${index}.example.com`, `alias${index}.example.com`],
        enabled: index % 2 === 0,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        certificateId: null,
        ...(kind === 'proxy'
            ? {
                  forwardHost: 'upstream.internal',
                  forwardScheme: 'http' as const,
                  forwardPort: 8080,
              }
            : { destination: 'https://upstream.internal/path', statusCode: 302 as const }),
    }))
    const state = {
        version: 1 as const,
        revision: 7,
        tags: [otherTag, tag],
        assignments: Object.fromEntries(
            basis.map((host, index) => [
                host.id,
                index % 3 === 0 ? [otherTag.id, tag.id] : [tag.id],
            ]),
        ),
    }
    const authorize = mock(async () => ({ id: 'actor' }))
    const reauthorize = mock(async () => undefined)
    const readTags = mock(async () => state)
    const readBasis = mock(async () => basis)
    const readSummaries = mock(async (_transaction: AuthTransaction, ids: readonly string[]) =>
        basis
            .filter((host) => ids.includes(host.id))
            .toReversed()
            .map((host) => Object.assign({}, host, { detail: 'hydrated' })),
    )
    const run = mock(() => undefined)
    const snapshot = async <T>(callback: (tx: AuthTransaction) => Promise<T>) => {
        run()
        return callback(transaction)
    }
    const labels = async (locale: keyof typeof LANGUAGE_RESOURCE_LOADERS) =>
        (await LANGUAGE_RESOURCE_LOADERS[locale]()).admin[
            kind === 'proxy' ? 'proxyHosts' : 'redirectHosts'
        ].status
    const read = createHostPageReader({
        kind,
        permission:
            kind === 'proxy' ? PERMISSIONS.PROXY_HOSTS_VIEW : PERMISSIONS.REDIRECT_HOSTS_VIEW,
        authorize,
        reauthorize,
        transaction: snapshot,
        readTags,
        readBasis,
        readSummaries,
        labels,
    })
    return {
        read,
        transaction,
        basis,
        state,
        authorize,
        reauthorize,
        readTags,
        readBasis,
        readSummaries,
        run,
        labels,
    }
}

describe.each(['proxy', 'redirect'] as const)('%s page snapshot', (kind) => {
    test('hydrates only selected IDs, keeps the page order and reads tags once in the authorized transaction', async () => {
        const fixture = setup(kind)
        const page = await fixture.read({ pageIndex: 1, sorting: [{ id: 'domains', desc: true }] })
        expect(page.total).toBe(25)
        expect(page.hosts).toHaveLength(10)
        expect(page.domains).toHaveLength(50)
        expect(page.hosts.every((host) => host.detail === 'hydrated')).toBeTrue()
        expect(fixture.readSummaries).toHaveBeenCalledWith(
            fixture.transaction,
            page.hosts.map((host) => host.id),
        )
        expect(fixture.readTags).toHaveBeenCalledTimes(1)
        expect(fixture.readTags).toHaveBeenCalledWith(fixture.transaction, kind)
        expect(fixture.run).toHaveBeenCalledTimes(1)
        expect(fixture.reauthorize).toHaveBeenCalledWith(
            fixture.transaction,
            'actor',
            kind === 'proxy' ? PERMISSIONS.PROXY_HOSTS_VIEW : PERMISSIONS.REDIRECT_HOSTS_VIEW,
        )
        expect(page.tags).toEqual(
            fixture.state.tags.toSorted((a, b) => a.name.localeCompare(b.name)),
        )
    })
    test('does not hydrate an empty page and preserves global facets', async () => {
        const fixture = setup(kind)
        const page = await fixture.read({ pageIndex: 3 })
        expect(page.hosts).toEqual([])
        expect(page.total).toBe(25)
        expect(page.domains).toHaveLength(50)
        expect(fixture.readSummaries).not.toHaveBeenCalled()
    })
    test('rejects revoked permissions before reading host or tag data', async () => {
        const fixture = setup(kind)
        fixture.reauthorize.mockImplementation(async () => {
            throw new Error('permission_denied')
        })
        await expect(fixture.read({})).rejects.toThrow('permission_denied')
        expect(fixture.readTags).not.toHaveBeenCalled()
        expect(fixture.readBasis).not.toHaveBeenCalled()
        expect(fixture.readSummaries).not.toHaveBeenCalled()
    })
    test.each(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt'] as const)(
        'preserves %s search and NUL-separated tag sorting',
        async (locale) => {
            const fixture = setup(kind)
            const labels = await fixture.labels(locale)
            const query = hostListQuerySchema.parse({
                locale,
                search: labels.enabled,
                sorting: [{ id: 'tags', desc: false }],
            })
            const expected = filterHostPage(
                fixture.basis.map((host) => ({
                    ...host,
                    tags: tagsForHost(fixture.state, host.id),
                })),
                fixture.state.tags,
                query,
                labels,
            )
            const page = await fixture.read(query)
            expect(page.hosts.map((host) => host.id)).toEqual(expected.hosts.map((host) => host.id))
            expect(page.total).toBe(expected.total)
            const umlaut = await fixture.read({
                locale,
                search: 'BÜRO',
                filters: [{ id: 'createdAt', value: { from: '2026-10-01', to: '2026-10-01' } }],
            })
            expect(umlaut.total).toBe(25)
        },
    )
})

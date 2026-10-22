import '@tanstack/react-start/server-only'

import { hostListQuerySchema } from '@/features/Admin/HostTags/validation.ts'
import { filterHostPage } from '@/lib/HostTags/hostList.ts'
import { tagsForHost } from '@/lib/HostTags/hostTags.ts'
import type { HostListEntry } from '@/lib/HostTags/Types/host-tags.types.ts'
import type { HostPageReaderDependencies } from './Types/host-page-reader.types.ts'

/** Keeps filtering, tag facets and page hydration in one authorized database snapshot. */
export function createHostPageReader<T extends HostListEntry, S extends T>(
    dependencies: HostPageReaderDependencies<T, S>,
) {
    return async (input: unknown) => {
        const query = hostListQuerySchema.parse(input)
        const actor = await dependencies.authorize(dependencies.permission)
        const labels = await dependencies.labels(query.locale)
        return dependencies.transaction(async (transaction) => {
            await dependencies.reauthorize(transaction, actor.id, dependencies.permission)
            const state = await dependencies.readTags(transaction, dependencies.kind)
            const basis = await dependencies.readBasis(transaction)
            const tagged = basis.map((host) =>
                Object.assign({}, host, { tags: tagsForHost(state, host.id) }),
            )
            const tags = state.tags.toSorted((a, b) => a.name.localeCompare(b.name))
            const page = filterHostPage(tagged, tags, query, labels)
            if (page.hosts.length === 0) return { ...page, hosts: [] as S[] }
            const hydrated = await dependencies.readSummaries(
                transaction,
                page.hosts.map((host) => host.id),
            )
            // The SQL reader orders by ID; preserve the user's selected page ordering.
            const byId = new Map(hydrated.map((host) => [host.id, host]))
            const hosts = page.hosts.map((host) => {
                const summary = byId.get(host.id)
                if (!summary) throw new Error('Host page snapshot is incomplete.')
                return { ...summary, tags: host.tags }
            })
            return { ...page, hosts }
        })
    }
}

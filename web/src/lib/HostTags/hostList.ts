import type { HostListQuery, HostPage, HostTag, HostListEntry } from './Types/host-tags.types.ts'

export function filterHostPage<T extends HostListEntry>(
    hosts: readonly T[],
    tags: readonly HostTag[],
    query: HostListQuery,
    statusLabels: { enabled: string; disabled: string },
): HostPage<T> {
    const lower = (value: string) => value.toLocaleLowerCase(query.locale)
    const searchable = (host: HostListEntry) => [
        ...host.domains,
        ...(host.tags?.map((tag) => tag.name) ?? []),
        host.enabled ? 'enabled' : 'disabled',
        host.enabled ? statusLabels.enabled : statusLabels.disabled,
        ...('forwardHost' in host
            ? [host.forwardHost, host.forwardScheme, String(host.forwardPort)]
            : [host.destination, String(host.statusCode)]),
    ]
    const search = lower(query.search.trim())
    const filtered = hosts.filter((host) => {
        if (search && !searchable(host).some((value) => lower(value).includes(search))) return false
        return query.filters.every((filter) => {
            if (filter.id === 'createdAt') {
                const day = host.createdAt.toISOString().slice(0, 10)
                return (
                    (!filter.value.from || day >= filter.value.from) &&
                    (!filter.value.to || day <= filter.value.to)
                )
            }
            if (!filter.value) return true
            switch (filter.id) {
                case 'tags':
                    return filter.value === 'untagged'
                        ? !host.tags?.length
                        : Boolean(host.tags?.some((tag) => tag.id === filter.value))
                case 'domains':
                    return host.domains.includes(filter.value)
                case 'status':
                    return (host.enabled ? 'enabled' : 'disabled') === filter.value
                case 'forward':
                    return 'forwardScheme' in host && host.forwardScheme === filter.value
                case 'destination':
                    return (
                        'destination' in host &&
                        lower(host.destination).includes(lower(filter.value.trim()))
                    )
                case 'statusCode':
                    return 'statusCode' in host && String(host.statusCode) === filter.value
                case 'certificate':
                    return (host.certificateId ? 'https' : 'http') === filter.value
            }
        })
    })
    const sortValue = (
        host: HostListEntry,
        id: HostListQuery['sorting'][number]['id'],
    ): string | number => {
        switch (id) {
            case 'tags':
                return (host.tags ?? [])
                    .map((tag) => lower(tag.name))
                    .toSorted()
                    .join('\u0000')
            case 'domains':
                return host.domains.join(' ')
            case 'status':
                return host.enabled ? 'enabled' : 'disabled'
            case 'createdAt':
                return host.createdAt.getTime()
            case 'destination':
                return 'destination' in host ? host.destination : ''
            case 'statusCode':
                return 'statusCode' in host ? host.statusCode : 0
            case 'certificate':
                return host.certificateId ? 'https' : 'http'
        }
    }
    filtered.sort((a, b) => {
        for (const sort of query.sorting) {
            const av = sortValue(a, sort.id),
                bv = sortValue(b, sort.id)
            const comparison =
                typeof av === 'number' && typeof bv === 'number'
                    ? av - bv
                    : String(av).localeCompare(String(bv), query.locale)
            if (comparison) return sort.desc ? -comparison : comparison
        }
        return a.id.localeCompare(b.id)
    })
    return {
        hosts: filtered.slice(
            query.pageIndex * query.pageSize,
            (query.pageIndex + 1) * query.pageSize,
        ),
        total: filtered.length,
        tags,
        domains: [...new Set(hosts.flatMap((host) => host.domains))].toSorted(),
    }
}

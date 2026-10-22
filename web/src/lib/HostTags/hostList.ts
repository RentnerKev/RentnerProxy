import type { HostListQuery, HostPage, HostTag, HostListEntry } from './Types/host-tags.types.ts'

/** Matches normalized search text; callers supply their existing extra search terms. */
export function matchesHostSearch(
    host: HostListEntry,
    search: string,
    locale: string,
    statusLabel: string,
    additionalValues: readonly string[] = [],
): boolean {
    if (!search) return true
    return [
        ...host.domains,
        statusLabel,
        ...('forwardHost' in host
            ? [host.forwardHost, host.forwardScheme, String(host.forwardPort)]
            : [host.destination, String(host.statusCode)]),
        ...additionalValues,
    ].some((value) => value.toLocaleLowerCase(locale).includes(search))
}

export function filterHostPage<T extends HostListEntry>(
    hosts: readonly T[],
    tags: readonly HostTag[],
    query: HostListQuery,
    statusLabels: { enabled: string; disabled: string },
): HostPage<T> {
    const lower = (value: string) => value.toLocaleLowerCase(query.locale)
    const search = lower(query.search.trim())
    const filtered = hosts.filter((host) => {
        const status = host.enabled ? 'enabled' : 'disabled'
        if (
            search &&
            !matchesHostSearch(host, search, query.locale, statusLabels[status], [
                status,
                ...(host.tags?.map((tag) => tag.name) ?? []),
            ])
        )
            return false
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

import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getHostTagCatalogHandler } from '../middleware.ts'
import type { HostKind } from '@/lib/HostTags/Types/host-tags.types.ts'

export default function useHostTagSelectLogic(kind: HostKind) {
    const id = useId()
    const query = useQuery({
        queryKey: ['admin', kind + '-hosts', 'tags'],
        queryFn: () => getHostTagCatalogHandler({ data: kind }),
    })
    return {
        state: {
            id,
            options: (query.data?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
            loading: query.isPending,
            error: query.isError,
        },
        handler: {
            retry: () => {
                void query.refetch()
            },
        },
    }
}

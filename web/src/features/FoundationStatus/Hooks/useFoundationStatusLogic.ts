import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import useLiveQuery from '../../../shared/Live/useLiveQuery'
import type { FoundationHealth } from '../../../shared/Types/health.types'
import { foundationStatusQueryKeys } from '../queryKeys'
import { getFoundationHealthHandler } from '../server'

export default function useFoundationStatusLogic() {
    const queryClient = useQueryClient()
    const healthQuery = useQuery({
        queryKey: foundationStatusQueryKeys.all,
        queryFn: () => getFoundationHealthHandler(),
    })
    const onLiveData = useCallback(
        async (data: FoundationHealth) => {
            await queryClient.cancelQueries({
                queryKey: foundationStatusQueryKeys.all,
                exact: true,
            })
            queryClient.setQueryData(foundationStatusQueryKeys.all, data)
        },
        [queryClient],
    )
    const liveStatus = useLiveQuery<FoundationHealth>({
        topic: 'foundation',
        query: {},
        enabled: true,
        onData: onLiveData,
    })

    return {
        state: {
            data: healthQuery.data,
            isError: healthQuery.isError,
            isPending: healthQuery.isPending,
            liveStatus,
        },
        handler: {
            retry: () => {
                void healthQuery.refetch()
            },
        },
    }
}

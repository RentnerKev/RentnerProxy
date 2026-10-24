import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import type { ForwardAuthSummary } from '@/lib/ForwardAuth/Types/forward-auth-summary.types.ts'
import { getForwardAuthSummaryHandler } from '../../../middleware.ts'

export default function useForwardAuthSummary(enabled: boolean) {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: crowdSecQueryKeys.forwardAuthSummary,
        queryFn: () => getForwardAuthSummaryHandler(),
        enabled,
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const onLiveData = useCallback(
        async (summary: ForwardAuthSummary) => {
            await queryClient.cancelQueries({
                queryKey: crowdSecQueryKeys.forwardAuthSummary,
                exact: true,
            })
            queryClient.setQueryData(crowdSecQueryKeys.forwardAuthSummary, summary)
        },
        [queryClient],
    )
    const liveStatus = useLiveQuery<ForwardAuthSummary>({
        topic: 'forward-auth',
        query: {},
        enabled,
        onData: onLiveData,
    })
    const runtimeState =
        query.isError || liveStatus === 'disconnected' ? 'unavailable' : query.data?.runtimeState

    return {
        state: {
            isPoliciesPending: enabled && query.isPending,
            isRuntimePending: enabled && query.isPending,
            policyCount: enabled ? query.data?.policyCount : undefined,
            assignedHosts: enabled ? query.data?.assignedHosts : undefined,
            runtimeState: enabled ? runtimeState : undefined,
        },
    }
}

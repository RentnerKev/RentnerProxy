import type { FoundationStatusLogicResult } from '../Types/foundation-status-logic.types.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'
import type { FoundationHealth } from '@/lib/FoundationStatus/Types/health.types.ts'
import {
    foundationStatusQueryKeys,
    replaceFoundationHealthCache,
} from '@/lib/FoundationStatus/foundationStatusCache.ts'
import { getFoundationHealthHandler } from '../middleware.ts'

export default function useFoundationStatusLogic(permissions: readonly string[]) {
    const queryClient = useQueryClient()
    const healthQuery = useQuery({
        queryKey: foundationStatusQueryKeys.all,
        queryFn: () => getFoundationHealthHandler(),
    })
    const onLiveData = useCallback(
        (data: FoundationHealth) => replaceFoundationHealthCache(queryClient, data),
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
            canViewCrowdSec: permissions.includes(PERMISSIONS.CROWDSEC_VIEW),
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
    } satisfies FoundationStatusLogicResult
}

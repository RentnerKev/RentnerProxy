import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { CrowdSecConfiguration } from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'
import { getCrowdSecConfigurationHandler } from '../../../middleware.ts'

export default function useSecurityDashboardPageLogic(permissions: readonly string[]) {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    })
    const onLiveData = useCallback(
        async (configuration: CrowdSecConfiguration) => {
            await queryClient.cancelQueries({
                queryKey: crowdSecQueryKeys.configuration,
                exact: true,
            })
            queryClient.setQueryData(crowdSecQueryKeys.configuration, configuration)
        },
        [queryClient],
    )
    const liveStatus = useLiveQuery<CrowdSecConfiguration>({
        topic: 'crowdsec-configuration',
        query: {},
        enabled: true,
        onData: onLiveData,
    })
    return {
        state: {
            canViewAccessPolicies: permissions.includes(PERMISSIONS.ACCESS_POLICIES_VIEW),
            configuration: query.data,
            // Cold retries reset query status to pending before the failed load has recovered.
            isError:
                query.isError ||
                liveStatus === 'disconnected' ||
                (query.data === undefined && query.errorUpdatedAt > 0),
            isRetrying: query.isFetching,
        },
        handler: { handleRetry: () => void query.refetch() },
    }
}

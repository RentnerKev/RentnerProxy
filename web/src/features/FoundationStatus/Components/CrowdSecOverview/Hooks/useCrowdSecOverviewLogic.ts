import type { CrowdSecOverviewLogicResult } from '../Types/crowd-sec-overview.types.ts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { CrowdSecConfiguration } from '@/lib/Admin/CrowdSec/Types/crowdsec.types.ts'
import useLiveQuery from '@/shared/Live/Hooks/useLiveQuery.ts'

import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import { getCrowdSecConfigurationHandler } from '@/features/Admin/CrowdSec/middleware.ts'

export default function useCrowdSecOverviewLogic(enabled: boolean) {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        enabled,
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
    useLiveQuery<CrowdSecConfiguration>({
        topic: 'crowdsec-configuration',
        query: {},
        enabled,
        onData: onLiveData,
    })

    return {
        state: {
            configuration: query.data,
            isPending: query.isPending,
            isError: query.isError,
        },
    } satisfies CrowdSecOverviewLogicResult
}

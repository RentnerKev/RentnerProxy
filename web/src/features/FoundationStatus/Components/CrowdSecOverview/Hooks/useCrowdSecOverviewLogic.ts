import type { CrowdSecOverviewLogicResult } from '../Types/crowd-sec-overview.types.ts'
import { useQuery } from '@tanstack/react-query'

import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import { getCrowdSecConfigurationHandler } from '@/features/Admin/CrowdSec/middleware.ts'

export default function useCrowdSecOverviewLogic(enabled: boolean) {
    const query = useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        enabled,
        refetchInterval: enabled ? 10_000 : false,
    })

    return {
        state: {
            configuration: query.data,
            isPending: query.isPending,
            isError: query.isError,
        },
        handler: {
            retry: () => void query.refetch(),
        },
    } satisfies CrowdSecOverviewLogicResult
}

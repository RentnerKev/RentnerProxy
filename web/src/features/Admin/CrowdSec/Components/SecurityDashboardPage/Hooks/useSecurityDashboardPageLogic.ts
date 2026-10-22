import { useQuery } from '@tanstack/react-query'

import { crowdSecQueryKeys } from '@/lib/Admin/CrowdSec/crowdSecCache.ts'
import { getCrowdSecConfigurationHandler } from '../../../middleware.ts'

export default function useSecurityDashboardPageLogic() {
    const query = useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        refetchInterval: 10_000,
    })
    return {
        state: {
            configuration: query.data,
            // Cold retries reset query status to pending before the failed load has recovered.
            isError: query.isError || (query.data === undefined && query.errorUpdatedAt > 0),
            isRetrying: query.isFetching,
        },
        handler: { handleRetry: () => void query.refetch() },
    }
}

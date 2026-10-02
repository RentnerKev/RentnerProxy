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
        state: { configuration: query.data, isError: query.isError },
        handler: { handleRetry: () => void query.refetch() },
    }
}

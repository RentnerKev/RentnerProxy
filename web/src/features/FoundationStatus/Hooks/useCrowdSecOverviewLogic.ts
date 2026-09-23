import { useQuery } from '@tanstack/react-query'

import { crowdSecQueryKeys } from '../../Admin/CrowdSec/queryKeys'
import { getCrowdSecConfigurationHandler } from '../../Admin/CrowdSec/server'

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
    }
}

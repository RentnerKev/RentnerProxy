import { useQuery } from '@tanstack/react-query'

import { crowdSecQueryKeys } from '../queryKeys'
import { getCrowdSecConfigurationHandler } from '../server'

export default function useSecurityDashboardPageLogic() {
    return useQuery({
        queryKey: crowdSecQueryKeys.configuration,
        queryFn: () => getCrowdSecConfigurationHandler(),
        refetchInterval: 10_000,
    })
}

import { useQuery } from '@tanstack/react-query'

import type { CrowdSecConfiguration } from '../../../../shared/Types/crowdsec.types'
import { crowdSecQueryKeys } from '../queryKeys'
import { getCrowdSecDashboardHandler } from '../server'

export default function useCrowdSecDashboardLogic(configuration: CrowdSecConfiguration) {
    const enabled = configuration.runtime?.enforcementActive === true
    const query = useQuery({
        queryKey: [
            ...crowdSecQueryKeys.dashboard,
            configuration.runtime?.mode,
            configuration.runtime?.apiUrl,
        ],
        queryFn: () => getCrowdSecDashboardHandler(),
        enabled,
        refetchInterval: 60_000,
        staleTime: 15_000,
        retry: 1,
    })
    return { enabled, query, snapshot: enabled ? query.data : undefined }
}

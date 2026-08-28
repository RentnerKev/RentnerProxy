import { useQuery } from '@tanstack/react-query'

import { foundationStatusQueryKeys } from '../queryKeys'
import { getFoundationHealthHandler } from '../server'

export default function useFoundationStatusLogic() {
    return useQuery({
        queryKey: foundationStatusQueryKeys.all,
        queryFn: () => getFoundationHealthHandler(),
        refetchInterval: 30_000,
    })
}

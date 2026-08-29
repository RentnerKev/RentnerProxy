import { useQuery } from '@tanstack/react-query'

import { foundationStatusQueryKeys } from '../queryKeys'
import { getFoundationHealthHandler } from '../server'

export default function useFoundationStatusLogic() {
    const healthQuery = useQuery({
        queryKey: foundationStatusQueryKeys.all,
        queryFn: () => getFoundationHealthHandler(),
        refetchInterval: 30_000,
    })

    return {
        state: {
            data: healthQuery.data,
            isError: healthQuery.isError,
            isPending: healthQuery.isPending,
        },
        handler: {
            retry: () => {
                void healthQuery.refetch()
            },
        },
    }
}

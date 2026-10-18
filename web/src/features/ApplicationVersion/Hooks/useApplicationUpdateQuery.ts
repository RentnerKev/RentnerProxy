import { useQuery } from '@tanstack/react-query'

import { getApplicationUpdateHandler } from '../middleware.ts'
import type { ApplicationUpdateResult } from '../Types/application-update.types.ts'

export default function useApplicationUpdateQuery(): ApplicationUpdateResult | undefined {
    const query = useQuery({
        queryKey: ['application-update'],
        queryFn: () => getApplicationUpdateHandler(),
        staleTime: 5 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
        refetchIntervalInBackground: false,
        retry: false,
    })
    return query.isError
        ? { status: 'unavailable', checkedAt: null, currentChannel: null, latest: null }
        : query.data
}

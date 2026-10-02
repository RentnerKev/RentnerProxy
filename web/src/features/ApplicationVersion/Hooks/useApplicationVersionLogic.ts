import type { ApplicationVersionLogicResult } from '../Types/application-version-logic.types.ts'
import { useQuery } from '@tanstack/react-query'

import { getApplicationUpdateHandler } from '../middleware.ts'

export default function useApplicationVersionLogic(): ApplicationVersionLogicResult {
    const query = useQuery({
        queryKey: ['application-update'],
        queryFn: () => getApplicationUpdateHandler(),
        staleTime: 60 * 60 * 1000,
        refetchInterval: 60 * 60 * 1000,
        refetchIntervalInBackground: false,
        retry: false,
    })
    return { state: { data: query.data } }
}

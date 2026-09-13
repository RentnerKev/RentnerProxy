import { useQuery } from '@tanstack/react-query'

import { getApplicationUpdateHandler } from '../server'

export default function useApplicationVersionLogic() {
    return useQuery({
        queryKey: ['application-update'],
        queryFn: () => getApplicationUpdateHandler(),
        staleTime: 60 * 60 * 1000,
        refetchInterval: 60 * 60 * 1000,
        refetchIntervalInBackground: false,
        retry: false,
    })
}

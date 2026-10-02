import type { QueryClient } from '@tanstack/react-query'
export const crowdSecQueryKeys = {
    configuration: ['crowdsec', 'configuration'] as const,
    dashboard: ['crowdsec', 'dashboard'] as const,
}

export function invalidateCrowdSecConfigurationCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: crowdSecQueryKeys.configuration })
}

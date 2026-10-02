import type { QueryClient } from '@tanstack/react-query'
export const trustedCaManagementQueryKeys = {
    all: ['admin', 'trusted-cas'] as const,
    assignable: ['admin', 'trusted-cas', 'assignable'] as const,
}

export function invalidateTrustedCaManagementCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: trustedCaManagementQueryKeys.all })
}

import type { QueryClient } from '@tanstack/react-query'
export const securityQueryKeys = {
    status: ['auth', 'account', 'security'] as const,
}

export function invalidateSecurityStatusCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: securityQueryKeys.status })
}

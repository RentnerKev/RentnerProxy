import type { QueryClient } from '@tanstack/react-query'
export const securityQueryKeys = {
    all: ['auth', 'account', 'security'] as const,
    status: (userId: string) => ['auth', 'account', 'security', userId] as const,
}

export function invalidateSecurityStatusCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: securityQueryKeys.all })
}

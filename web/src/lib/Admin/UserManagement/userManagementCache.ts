import type { QueryClient } from '@tanstack/react-query'
export const userManagementQueryKeys = {
    all: ['auth', 'users'] as const,
}

export function invalidateUserManagementCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: userManagementQueryKeys.all })
}

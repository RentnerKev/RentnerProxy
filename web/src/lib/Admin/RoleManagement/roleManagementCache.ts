import type { QueryClient } from '@tanstack/react-query'
export const roleManagementQueryKeys = {
    all: ['auth', 'roles'] as const,
}

export function invalidateRoleManagementCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: roleManagementQueryKeys.all })
}

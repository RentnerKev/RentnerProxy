import type { QueryClient } from '@tanstack/react-query'
export const redirectHostManagementQueryKeys = {
    all: ['admin', 'redirect-hosts'] as const,
    runtimeStatus: ['admin', 'redirect-hosts', 'runtime-status'] as const,
    assignableCertificates: ['admin', 'redirect-hosts', 'assignable-certificates'] as const,
}

export function invalidateRedirectHostManagementCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: redirectHostManagementQueryKeys.all })
}

export function invalidateRedirectHostManagementRuntimeStatusCache(
    queryClient: QueryClient,
): Promise<void> {
    return queryClient.invalidateQueries({
        queryKey: redirectHostManagementQueryKeys.runtimeStatus,
    })
}

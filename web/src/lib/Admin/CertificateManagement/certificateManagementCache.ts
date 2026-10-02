import type { QueryClient } from '@tanstack/react-query'
export const certificateManagementQueryKeys = {
    all: ['admin', 'certificates'] as const,
    details: (certificateId: string) =>
        ['admin', 'certificates', 'details', certificateId] as const,
    assignable: ['admin', 'certificates', 'assignable'] as const,
}

export function invalidateCertificateManagementCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: certificateManagementQueryKeys.all })
}

export function invalidateCertificateManagementAssignableCache(
    queryClient: QueryClient,
): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: certificateManagementQueryKeys.assignable })
}

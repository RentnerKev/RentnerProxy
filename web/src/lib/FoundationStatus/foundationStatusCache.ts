import type { QueryClient } from '@tanstack/react-query'
import type { FoundationHealth } from '@/shared/Types/health.types.ts'
export const foundationStatusQueryKeys = {
    all: ['foundation-health'] as const,
}

export async function replaceFoundationHealthCache(
    queryClient: QueryClient,
    data: FoundationHealth,
): Promise<void> {
    await queryClient.cancelQueries({ queryKey: foundationStatusQueryKeys.all, exact: true })
    queryClient.setQueryData(foundationStatusQueryKeys.all, data)
}

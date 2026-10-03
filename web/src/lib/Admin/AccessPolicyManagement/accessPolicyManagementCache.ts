import type { QueryClient } from '@tanstack/react-query'
const accessPolicyQueryKeys = {
    all: ['admin', 'access-policies'] as const,
    assignable: ['admin', 'access-policies', 'assignable'] as const,
    runtimeStatus: ['admin', 'access-policies', 'runtime-status'] as const,
    basicAuthAccounts: (accessPolicyId: string) =>
        ['admin', 'access-policies', accessPolicyId, 'basic-auth-accounts'] as const,
}

export const accessPolicyManagementQueryKeys = accessPolicyQueryKeys

export function invalidateAccessPoliciesCache(
    queryClient: QueryClient,
    exact?: boolean,
): Promise<void> {
    return queryClient.invalidateQueries({
        queryKey: accessPolicyQueryKeys.all,
        ...(exact === undefined ? {} : { exact }),
    })
}

export function invalidateAssignableAccessPoliciesCache(
    queryClient: QueryClient,
    exact?: boolean,
): Promise<void> {
    return queryClient.invalidateQueries({
        queryKey: accessPolicyQueryKeys.assignable,
        ...(exact === undefined ? {} : { exact }),
    })
}

export function invalidateAccessPolicyRuntimeStatusCache(
    queryClient: QueryClient,
    exact?: boolean,
): Promise<void> {
    return queryClient.invalidateQueries({
        queryKey: accessPolicyQueryKeys.runtimeStatus,
        ...(exact === undefined ? {} : { exact }),
    })
}

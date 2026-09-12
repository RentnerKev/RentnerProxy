export const accessPolicyQueryKeys = {
    all: ['admin', 'access-policies'] as const,
    assignable: ['admin', 'access-policies', 'assignable'] as const,
    runtimeStatus: ['admin', 'access-policies', 'runtime-status'] as const,
    basicAuthAccounts: (accessPolicyId: string) =>
        ['admin', 'access-policies', accessPolicyId, 'basic-auth-accounts'] as const,
}

export const accessPolicyManagementQueryKeys = accessPolicyQueryKeys

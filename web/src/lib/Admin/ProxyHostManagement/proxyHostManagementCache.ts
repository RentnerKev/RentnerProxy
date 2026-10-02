import type { QueryClient } from '@tanstack/react-query'
export const proxyHostManagementQueryKeys = {
    all: ['admin', 'proxy-hosts'] as const,
    runtimeStatus: ['admin', 'proxy-hosts', 'runtime-status'] as const,
    configEditor: ['admin', 'proxy-hosts', 'config-editor'] as const,
    hostConfigEditor: (hostId: string) => ['admin', 'proxy-hosts', 'host-config', hostId] as const,
}

export function invalidateProxyHostManagementCache(queryClient: QueryClient): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.all })
}

export function invalidateProxyHostManagementRuntimeStatusCache(
    queryClient: QueryClient,
): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.runtimeStatus })
}

export function invalidateProxyHostManagementConfigEditorCache(
    queryClient: QueryClient,
): Promise<void> {
    return queryClient.invalidateQueries({ queryKey: proxyHostManagementQueryKeys.configEditor })
}

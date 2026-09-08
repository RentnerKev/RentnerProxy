export const proxyHostManagementQueryKeys = {
    all: ['admin', 'proxy-hosts'] as const,
    runtimeStatus: ['admin', 'proxy-hosts', 'runtime-status'] as const,
    configEditor: ['admin', 'proxy-hosts', 'config-editor'] as const,
    hostConfigEditor: (hostId: string) => ['admin', 'proxy-hosts', 'host-config', hostId] as const,
}

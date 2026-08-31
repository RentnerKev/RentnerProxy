export const proxyHostManagementQueryKeys = {
    all: ['admin', 'proxy-hosts'] as const,
    runtimeStatus: ['admin', 'proxy-hosts', 'runtime-status'] as const,
    configEditor: ['admin', 'proxy-hosts', 'config-editor'] as const,
    hostConfigEditor: (hostId: string, canAdvancedConfig = false) =>
        ['admin', 'proxy-hosts', 'host-config', hostId, canAdvancedConfig] as const,
}

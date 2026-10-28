export const hostMonitoringQueryKeys = {
    all: ['host-monitoring'] as const,
    summary: (proxyHostIds: readonly string[]) =>
        ['host-monitoring', 'summary', proxyHostIds.toSorted()] as const,
    policy: (proxyHostId: string) => ['host-monitoring', 'policy', proxyHostId] as const,
    history: (input: unknown) => ['host-monitoring', 'history', input] as const,
}

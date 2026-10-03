export type CrowdSecMode = 'disabled' | 'managed'

export type CrowdSecRuntimeStatus = Readonly<{
    mode: 'disabled' | 'managed' | 'external'
    state: 'disabled' | 'starting' | 'connected' | 'degraded'
    apiUrl?: string
    credentialConfigured: boolean
    enforcementActive: boolean
    managedEngine: 'stopped' | 'starting' | 'ready' | 'restarting' | 'degraded' | 'unavailable'
    communityEnabled: boolean
    communityState: 'disabled' | 'starting' | 'connected' | 'degraded'
    consoleState: 'not_enrolled' | 'pending' | 'connected' | 'degraded'
    failureBehavior: 'fail_open'
    clientIpSource: 'caddy'
}>

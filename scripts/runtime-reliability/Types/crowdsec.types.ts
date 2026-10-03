export type ManagedStatus = {
    state: 'disabled' | 'starting' | 'connected' | 'degraded'
    managedEngine: 'stopped' | 'starting' | 'ready' | 'restarting' | 'degraded' | 'unavailable'
}

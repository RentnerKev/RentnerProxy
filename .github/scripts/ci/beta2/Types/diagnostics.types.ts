export type Beta2Action =
    'bulk-disable' | 'bulk-enable' | 'ddns' | 'recreate' | 'notifications' | 'updates'

export interface Beta2Diagnostic {
    readonly round: number
    readonly event: 'action-start' | 'action-complete' | 'action-failure' | 'transport-failure'
    readonly elapsedMs: number
    readonly activeStages: Beta2Action[]
    readonly stage?: Beta2Action
    readonly domain?: string
    readonly errorCode?: string
}

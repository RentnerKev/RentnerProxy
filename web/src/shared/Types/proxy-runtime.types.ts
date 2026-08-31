export type ProxyRuntimeMutationStatus = 'applied' | 'pending'

export interface ProxyRuntimeStatus {
    readonly available: boolean
    readonly running: boolean
    readonly activeRevision: string | null
    readonly lastApplyAt: string | null
}

export interface ProxyRuntimeSyncStatus extends ProxyRuntimeStatus {
    readonly state: 'synced' | 'pending' | 'unavailable'
    readonly desiredRevision: string
}

export type ProxyHostActionResult =
    | { readonly success: false; readonly message: string }
    | {
          readonly success: true
          readonly message: string
          readonly runtimeStatus: ProxyRuntimeMutationStatus
      }

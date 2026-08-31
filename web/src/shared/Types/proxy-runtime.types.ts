export type ProxyRuntimeMutationStatus = 'applied' | 'pending'

export interface ProxyHttpSettings {
    readonly clientMaxBodySizeBytes?: number
    readonly proxyConnectTimeoutSeconds?: number
    readonly proxyReadTimeoutSeconds?: number
    readonly proxySendTimeoutSeconds?: number
    readonly sendTimeoutSeconds?: number
    readonly keepaliveTimeoutSeconds?: number
}

export interface ProxyConfigSource {
    readonly config: string
    readonly revision: string | null
}

export interface ProxyConfigEditorData {
    readonly baseRevision: string
    readonly settingsSource: string
    readonly active: ProxyConfigSource | null
    readonly defaults: ProxyConfigSource | null
}

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

export interface ProxyHostConfigEditorData extends ProxyConfigEditorData {
    readonly advancedConfig?: string
    readonly proxyHostId: string
    readonly hostLabel: string
    readonly enabled: boolean
    readonly generated: ProxyConfigSource | null
    readonly commonSettingsSource: string
}

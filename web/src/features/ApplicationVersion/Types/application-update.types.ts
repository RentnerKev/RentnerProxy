export type ReleaseChannel = 'alpha' | 'beta' | 'stable'

export type UpdateImageStatus =
    | 'verified'
    | 'pending'
    | 'unavailable'
    | 'unsupported-platform'
    | 'invalid'

export interface ApplicationUpdate {
    readonly version: string
    readonly tag: string
    readonly channel: ReleaseChannel
    readonly url: string
    readonly notes: string | null
    readonly image: {
        readonly status: UpdateImageStatus
        readonly reference: string | null
        readonly digest: string | null
        readonly platform: string
    }
    readonly compatibility: {
        readonly status: 'supported' | 'requires-beta1' | 'unsupported'
        readonly minimumVersion: string | null
        readonly intermediateVersion: string | null
    }
}

export interface ApplicationUpdateResult {
    readonly status: 'disabled' | 'current' | 'available' | 'unavailable'
    readonly checkedAt: string | null
    readonly currentChannel: ReleaseChannel | null
    readonly latest: ApplicationUpdate | null
}

import type { QueryKey } from '@tanstack/react-query'

type LiveInvalidationTopic = 'proxy-hosts' | 'certificates' | 'redirect-hosts' | 'access-policies'

export interface LiveRevisionSnapshot {
    readonly revision: string
}

export interface UseLiveInvalidationOptions {
    readonly topic: LiveInvalidationTopic
    readonly query: object
    readonly enabled: boolean
    readonly queryKeys: readonly QueryKey[]
}

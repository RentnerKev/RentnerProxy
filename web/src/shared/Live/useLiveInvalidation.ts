import { useCallback, useRef } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

import useLiveQuery from './useLiveQuery'

export type LiveInvalidationTopic =
    | 'proxy-hosts'
    | 'certificates'
    | 'redirect-hosts'
    | 'access-policies'

export interface LiveRevisionSnapshot {
    readonly revision: string
}

interface UseLiveInvalidationOptions {
    readonly topic: LiveInvalidationTopic
    readonly query: object
    readonly enabled: boolean
    readonly queryKeys: readonly QueryKey[]
}

export default function useLiveInvalidation({
    topic,
    query,
    enabled,
    queryKeys,
}: UseLiveInvalidationOptions): ReturnType<typeof useLiveQuery> {
    const queryClient = useQueryClient()
    const revisionRef = useRef<string | undefined>(undefined)
    const onData = useCallback(
        (snapshot: LiveRevisionSnapshot) => {
            if (!snapshot || typeof snapshot.revision !== 'string') return
            const previousRevision = revisionRef.current
            revisionRef.current = snapshot.revision
            if (previousRevision === snapshot.revision) return
            void Promise.all(
                queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
            )
        },
        [queryClient, queryKeys],
    )

    return useLiveQuery<LiveRevisionSnapshot>({
        topic,
        query,
        enabled,
        onData,
    })
}

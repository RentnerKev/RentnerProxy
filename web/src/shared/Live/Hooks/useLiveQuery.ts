import { useEffect, useRef, useState } from 'react'

import { subscribeToRealtimeEvents } from '@/lib/Live/realtimeEventsClient.ts'
import type { LiveStatus } from '@/lib/Live/Types/realtime-events-client.types.ts'
import type { LiveTopic } from '@/lib/Live/Types/events.types.ts'

export default function useLiveQuery<T>({
    topic,
    query,
    enabled,
    onData,
    onUnauthorized,
    onResume,
}: {
    topic: LiveTopic
    query: object
    enabled: boolean
    onData: (data: T) => void | Promise<void>
    onUnauthorized?: () => void
    onResume?: () => void
}): LiveStatus {
    const [status, setStatus] = useState<LiveStatus>('inactive')
    const dataCallback = useRef(onData)
    const unauthorizedCallback = useRef(onUnauthorized)
    const resumeCallback = useRef(onResume)
    useEffect(() => {
        dataCallback.current = onData
    }, [onData])
    useEffect(() => {
        unauthorizedCallback.current = onUnauthorized
    }, [onUnauthorized])
    useEffect(() => {
        resumeCallback.current = onResume
    }, [onResume])
    const serializedQuery = JSON.stringify(query)

    useEffect(() => {
        if (
            !enabled ||
            typeof window === 'undefined' ||
            !/^https?:$/.test(window.location.protocol)
        ) {
            return
        }
        return subscribeToRealtimeEvents<T>({
            topic,
            query: JSON.parse(serializedQuery) as object,
            onData: (data) => dataCallback.current(data),
            onStatus: setStatus,
            onUnauthorized: () => unauthorizedCallback.current?.(),
            onResume: () => resumeCallback.current?.(),
        })
    }, [enabled, topic, serializedQuery])

    return enabled ? status : 'inactive'
}

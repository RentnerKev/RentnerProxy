import '@tanstack/react-start/server-only'

import type { RedisClient } from 'bun'
import { receiveApplicationChange, setApplicationPublisher } from './applicationChanges.ts'
import { getValkeyClient } from '@/server/valkey/client.server.ts'
import { applicationChangedEventSchema } from '@/lib/Live/events.ts'

const CHANNEL = 'rentnerproxy:realtime'

declare global {
    var rentnerproxyRealtimeValkey: { stop: () => void } | undefined
}

export function startRealtimeValkey(): void {
    if (globalThis.rentnerproxyRealtimeValkey) return
    let stopped = false
    let subscriber: RedisClient | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
        stopped = true
        clearTimeout(retry)
        subscriber?.close()
        setApplicationPublisher(undefined)
        globalThis.rentnerproxyRealtimeValkey = undefined
    }
    globalThis.rentnerproxyRealtimeValkey = { stop }
    process.once('rentnerproxy:shutdown', stop)

    async function connect(): Promise<void> {
        try {
            const publisher = getValkeyClient()
            if (!publisher) return
            const connection = await publisher.duplicate()
            if (stopped) {
                connection.close()
                return
            }
            subscriber = connection
            await connection.subscribe(CHANNEL, (message) => {
                try {
                    const event = applicationChangedEventSchema.safeParse(JSON.parse(message))
                    if (event.success) receiveApplicationChange(event.data)
                } catch {
                    return
                }
            })
            if (stopped) return
            setApplicationPublisher((event) => publisher.publish(CHANNEL, JSON.stringify(event)))
        } catch {
            subscriber?.close()
            subscriber = undefined
            if (!stopped) {
                retry = setTimeout(() => {
                    void connect()
                }, 5000)
                retry.unref()
            }
        }
    }
    void connect()
}

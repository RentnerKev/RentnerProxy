import '@tanstack/react-start/server-only'

import type { RedisClient } from 'bun'
import { receiveApplicationChange, setApplicationPublisher } from '../Helpers/publishFunctions'
import { getRedisClient } from '../../server/redis/client.server'
import { applicationChangedEventSchema } from '../Types/events'

const CHANNEL = 'rentnerproxy:realtime'

declare global {
    var rentnerproxyRealtimeRedis: { stop: () => void } | undefined
}

export function startRealtimeRedis(): void {
    if (globalThis.rentnerproxyRealtimeRedis) return
    let stopped = false
    let subscriber: RedisClient | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
        stopped = true
        clearTimeout(retry)
        subscriber?.close()
        setApplicationPublisher(undefined)
        globalThis.rentnerproxyRealtimeRedis = undefined
    }
    globalThis.rentnerproxyRealtimeRedis = { stop }
    process.once('rentnerproxy:shutdown', stop)

    async function connect(): Promise<void> {
        try {
            const publisher = getRedisClient()
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

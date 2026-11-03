import '@tanstack/react-start/server-only'
// oxlint-disable unicorn/prefer-add-event-listener -- Bun RedisClient exposes lifecycle callback properties, not EventTarget.

import type { RedisClient } from 'bun'
import { receiveApplicationChange, setApplicationPublisher } from './applicationChanges.ts'
import { getValkeyClient } from '@/server/Valkey/client.server.ts'
import { applicationChangedEventSchema } from '@/lib/Live/events.ts'

const CHANNEL = 'rentnerproxy:realtime'

declare global {
    var rentnerproxyRealtimeValkey: { stop: () => void } | undefined
}

export function startRealtimeValkey(): void {
    if (globalThis.rentnerproxyRealtimeValkey) return
    let stopped = false
    let generation = 0
    let subscriber: RedisClient | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
        stopped = true
        generation += 1
        clearTimeout(retry)
        if (subscriber) {
            subscriber.onclose = null
            subscriber.onconnect = null
        }
        subscriber?.close()
        setApplicationPublisher(undefined)
        globalThis.rentnerproxyRealtimeValkey = undefined
    }
    globalThis.rentnerproxyRealtimeValkey = { stop }
    process.once('rentnerproxy:shutdown', stop)

    function scheduleReconnect(): void {
        if (stopped || retry !== undefined) return
        retry = setTimeout(() => {
            retry = undefined
            void connect()
        }, 5000)
        retry.unref()
    }

    async function connect(): Promise<void> {
        if (stopped) return
        const current = ++generation
        let connection: RedisClient | undefined
        let publisherAvailable = false
        try {
            const publisher = getValkeyClient()
            if (!publisher) {
                setApplicationPublisher(undefined)
                return
            }
            // Publishing uses the independent command connection and stays available
            // while the owned subscription is reconnecting or awaiting acknowledgement.
            setApplicationPublisher((event) => publisher.publish(CHANNEL, JSON.stringify(event)))
            publisherAvailable = true
            connection = await publisher.duplicate()
            if (stopped || current !== generation) {
                connection.close()
                return
            }
            subscriber = connection
            const owned = connection
            let subscribed = false
            const reconnect = () => {
                if (stopped || current !== generation) return
                generation += 1
                subscriber = undefined
                owned.onclose = null
                owned.onconnect = null
                owned.close()
                scheduleReconnect()
            }
            // A new owned connection gives every recovery an acknowledged subscription.
            connection.onclose = reconnect
            connection.onconnect = () => {
                if (subscribed) reconnect()
            }
            await connection.subscribe(CHANNEL, (message) => {
                if (stopped || current !== generation) return
                try {
                    const event = applicationChangedEventSchema.safeParse(JSON.parse(message))
                    if (event.success) receiveApplicationChange(event.data)
                } catch {
                    return
                }
            })
            if (stopped || current !== generation) return
            subscribed = true
            // Pub/sub cannot replay missed events. Resample locally after recovery without
            // publishing a synthetic mutation to the bus or producing subscriber echoes.
            receiveApplicationChange({
                type: 'application.updated',
                payload: { version: crypto.randomUUID() },
            })
        } catch {
            if (stopped || current !== generation) return
            generation += 1
            if (connection) {
                connection.onclose = null
                connection.onconnect = null
                connection.close()
            }
            subscriber = undefined
            if (!publisherAvailable) setApplicationPublisher(undefined)
            scheduleReconnect()
        }
    }
    void connect()
}

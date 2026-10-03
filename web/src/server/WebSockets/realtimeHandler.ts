import type { RealtimeHandlerOptions } from './Types/realtime-handler.types.ts'
import { LIVE_MAX_MESSAGE_BYTES, LIVE_MAX_MESSAGES_PER_SECOND } from '@/config/realtime.config.ts'
import { parseLiveMessage } from '@/lib/Live/messages.ts'
import { byteLength, parseQuery, topicFrom } from '@/lib/Live/snapshot.ts'
import type { LiveSocketData } from './Types/bun.types.ts'
import type { LiveConnectionData } from './Types/realtime-subscriptions.types.ts'

export function createRealtimeHandler(
    options: RealtimeHandlerOptions,
): Bun.WebSocketHandler<LiveSocketData> {
    return {
        data: {} as LiveSocketData,
        idleTimeout: options.idleTimeoutSeconds,
        maxPayloadLength: LIVE_MAX_MESSAGE_BYTES,
        backpressureLimit: options.maxPayloadBytes,
        closeOnBackpressureLimit: true,
        sendPings: true,
        open(ws) {
            const connection = ws.data.connection as LiveConnectionData
            connection.ws = ws
            if (connection.closed) options.lifecycle.close(connection, 1012, 'Server restarting')
        },
        message(ws, message) {
            const connection = ws.data.connection as LiveConnectionData
            const now = Date.now()
            if (now - connection.messageWindowStarted >= 1_000) {
                connection.messageWindowStarted = now
                connection.messageCount = 0
            }
            connection.messageCount += 1
            if (connection.messageCount > LIVE_MAX_MESSAGES_PER_SECOND) {
                options.lifecycle.close(connection, 1008, 'Too many live messages')
                return
            }
            const parsed = parseLiveMessage(message)
            if (!parsed) {
                options.lifecycle.close(connection, 1008, 'Invalid live message')
                return
            }
            const topic = topicFrom(parsed.topic)
            if (parsed.type === 'unsubscribe') {
                if (!topic || parsed.query !== undefined) {
                    options.lifecycle.close(connection, 1008, 'Invalid live message')
                    return
                }
                options.manager.unsubscribe(connection, topic)
                return
            }
            if (parsed.type !== 'subscribe' || !topic) {
                options.lifecycle.close(connection, 1008, 'Invalid live message')
                return
            }
            const parsedQuery = parseQuery(parsed.query)
            if (!parsedQuery || byteLength(parsedQuery.queryText) > options.maxQueryBytes) {
                options.lifecycle.close(connection, 1008, 'Invalid live query')
                return
            }
            if (
                !options.manager.subscribe(
                    connection,
                    topic,
                    parsedQuery.query,
                    parsedQuery.queryText,
                )
            ) {
                options.lifecycle.close(connection, 1008, 'Too many live subscriptions')
            }
        },
        close(ws) {
            options.lifecycle.dispose(ws.data.connection as LiveConnectionData)
        },
    }
}

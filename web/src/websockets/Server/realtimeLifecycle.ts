import type { LiveConnectionData } from './realtimeSubscriptions'
import type { LiveSubscriptionManager } from './realtimeSubscriptions'

interface RealtimeLifecycleOptions {
    readonly manager: LiveSubscriptionManager
    readonly pending: Set<LiveConnectionData>
}

export function createRealtimeLifecycle(options: RealtimeLifecycleOptions) {
    function dispose(connection: LiveConnectionData): void {
        if (connection.closed) return
        connection.closed = true
        options.manager.dispose(connection)
        options.manager.connections.delete(connection)
        options.pending.delete(connection)
    }

    function close(connection: LiveConnectionData, code: number, reason: string): void {
        if (connection.closed) return
        const ws = connection.ws
        dispose(connection)
        try {
            ws?.close(code, reason)
        } catch {
            return
        }
    }

    function unauthorized(connection: LiveConnectionData): void {
        if (connection.closed) return
        try {
            connection.ws?.sendText(JSON.stringify({ type: 'unauthorized' }))
        } catch {
            close(connection, 4001, 'Unauthorized')
            return
        }
        close(connection, 4001, 'Unauthorized')
    }

    return { dispose, close, unauthorized }
}

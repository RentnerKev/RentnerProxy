import type { ServerWebSocket } from 'bun'

import type { LiveTopic } from '../Helpers/realtimeConstants'

export type MaybePromise<T> = T | Promise<T>

export interface LiveUpgradeResult {
    readonly handled: boolean
    readonly response?: Response
}

export interface LiveSnapshotReaderRequest {
    readonly request: Request
    readonly topic: LiveTopic
    readonly query: unknown
}

export type LiveSnapshotReader = (
    request: Request,
    context: LiveSnapshotReaderRequest,
) => MaybePromise<Response>

export interface LiveWebSocketRuntimeOptions {
    readonly allowedOrigin: string | ((request: Request) => MaybePromise<string | null | undefined>)
    readonly readSnapshot: LiveSnapshotReader
    readonly snapshotPath?: string
    readonly maxConnections?: number
    readonly maxPayloadBytes?: number
    readonly maxQueryBytes?: number
    readonly idleTimeoutSeconds?: number
    readonly snapshotTimeoutMs?: number
}

export interface LiveSocketData {
    readonly connection: unknown
}

export interface LiveWebSocketRuntime {
    readonly websocket: Bun.WebSocketHandler<LiveSocketData>
    readonly handle: (
        request: Request,
        server: Bun.Server<LiveSocketData>,
    ) => Promise<LiveUpgradeResult>
    readonly shutdown: () => Promise<void>
    readonly connectionCount: number
    readonly samplingGroupCount: number
}

export type LiveServerWebSocket = ServerWebSocket<LiveSocketData>

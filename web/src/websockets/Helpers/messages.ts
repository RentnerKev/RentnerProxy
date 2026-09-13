import { LIVE_MAX_MESSAGE_BYTES } from './realtimeConstants'
import { byteLength, isRecord } from './snapshot'

export interface ParsedLiveMessage {
    readonly type: unknown
    readonly topic: unknown
    readonly query: unknown
}

export function parseLiveMessage(
    message: string | ArrayBuffer | Uint8Array,
    maxBytes = LIVE_MAX_MESSAGE_BYTES,
): ParsedLiveMessage | null {
    const text =
        typeof message === 'string'
            ? message
            : new TextDecoder().decode(
                  message instanceof ArrayBuffer ? new Uint8Array(message) : message,
              )
    if (byteLength(text) > maxBytes) return null
    try {
        const value: unknown = JSON.parse(text)
        if (!isRecord(value)) return null
        return { type: value.type, topic: value.topic, query: value.query }
    } catch {
        return null
    }
}

export const REALTIME_WS_PATH = '/api/live'
export const LIVE_SNAPSHOT_PATH = '/api/live-snapshot'

export const LIVE_TOPICS = [
    'access-logs',
    'audit-logs',
    'foundation',
    'app-events',
    'proxy-hosts',
    'certificates',
    'redirect-hosts',
    'access-policies',
] as const

export type LiveTopic = (typeof LIVE_TOPICS)[number]

export const LIVE_INTERVALS: Readonly<Record<LiveTopic, number>> = {
    'access-logs': 2_000,
    'audit-logs': 2_000,
    foundation: 30_000,
    'app-events': 60_000,
    'proxy-hosts': 2_000,
    certificates: 2_000,
    'redirect-hosts': 15_000,
    'access-policies': 15_000,
}

export const LIVE_MAX_CONNECTIONS = 100
export const LIVE_MAX_SUBSCRIPTIONS = 8
export const LIVE_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
export const LIVE_MAX_QUERY_BYTES = 8 * 1024
export const LIVE_MAX_MESSAGE_BYTES = 16 * 1024
export const LIVE_MAX_MESSAGES_PER_SECOND = 30
export const LIVE_IDLE_TIMEOUT_SECONDS = 90
export const LIVE_SNAPSHOT_TIMEOUT_MS = 10_000

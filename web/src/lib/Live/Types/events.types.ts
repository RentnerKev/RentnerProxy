import type { z } from 'zod'

import type {
    liveTopicSchema,
    applicationChangedEventSchema,
    realtimeEventSchema,
} from '../events.ts'

export type LiveTopic = z.infer<typeof liveTopicSchema>

export type ApplicationChangedEvent = z.infer<typeof applicationChangedEventSchema>

type RealtimeEvent = z.infer<typeof realtimeEventSchema>

export type SnapshotEvent = Extract<RealtimeEvent, { type: 'snapshot' }>

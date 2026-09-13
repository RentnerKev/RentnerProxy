import { z } from 'zod'
import { LIVE_TOPICS } from '../Helpers/realtimeConstants'

export const liveTopicSchema = z.enum(LIVE_TOPICS)

export type LiveTopic = z.infer<typeof liveTopicSchema>

export const applicationChangedEventSchema = z.object({
    type: z.literal('application.updated'),
    payload: z.object({ version: z.string().min(1).max(64) }),
})
export type ApplicationChangedEvent = z.infer<typeof applicationChangedEventSchema>

export const realtimeEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('snapshot'),
        topic: liveTopicSchema,
        query: z.record(z.string(), z.unknown()),
        payload: z.unknown(),
    }),
    z.object({ type: z.literal('unauthorized') }),
])

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>
export type SnapshotEvent = Extract<RealtimeEvent, { type: 'snapshot' }>

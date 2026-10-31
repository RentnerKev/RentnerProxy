import { z } from 'zod'
import {
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_LIMITS,
    NOTIFICATION_SEVERITIES,
} from '@/config/notifications.config.ts'
import type { NotificationState } from './Types/notification-state.types.ts'
import { hostAvailabilityNotificationSchema } from '@/lib/Notifications/validation.ts'

const time = z.number().int().min(0).max(8_640_000_000_000_000)
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const admission = z.enum(['pending', 'succeeded', 'failed'])
const identifier = z.string().uuid()
const error = z.enum([
    'destination_blocked',
    'destination_unavailable',
    'redirect_denied',
    'http_rejected',
    'smtp_unavailable',
    'timeout',
    'cancelled',
    'payload_limit',
    'configuration_unavailable',
])
const payload = z.strictObject({
    schemaVersion: z.literal(1),
    id: identifier,
    incidentId: identifier,
    type: z.enum(['incident', 'recovery', 'success', 'test']),
    category: z.enum(NOTIFICATION_CATEGORIES),
    severity: z.enum([...NOTIFICATION_SEVERITIES, 'info']),
    resourceId: z.string().min(1).max(512),
    code: z.enum([
        'certificate_renewal_manual_dns_required',
        'certificate_renewal_failed',
        'ddns_update_failed',
        'proxy_apply_failed',
        'host_unavailable',
        'operation_recovered',
        'notification_test',
        'backup_succeeded',
        'backup_failed',
    ]),
    occurredAt: z.iso.datetime(),
    startedAt: z.iso.datetime(),
    failures: counter,
    host: hostAvailabilityNotificationSchema.optional(),
})

export const notificationStateSchema: z.ZodType<NotificationState> = z
    .strictObject({
        version: z.literal(1),
        proxyApplyPending: z
            .strictObject({
                desiredRevision: z.string().min(1).max(128),
                since: time,
                observedAt: time,
            })
            .nullable(),
        deferredCount: counter,
        saturationCount: counter,
        incidents: z
            .array(
                z.strictObject({
                    id: identifier,
                    category: z.enum(NOTIFICATION_CATEGORIES),
                    resourceId: z.string().min(1).max(512),
                    severity: z.enum(NOTIFICATION_SEVERITIES),
                    startedAt: time,
                    observedAt: time,
                    evidence: z.string().max(512),
                    failures: counter,
                    code: z.literal('certificate_renewal_manual_dns_required').optional(),
                    recoveredAt: time.nullable(),
                    recoveryEvidence: z.string().length(64).nullable(),
                    channels: z
                        .array(
                            z.strictObject({
                                channelId: identifier,
                                channelRevision: revision,
                                failure: admission,
                                recovery: admission.nullable(),
                            }),
                        )
                        .max(NOTIFICATION_LIMITS.totalChannels),
                    host: hostAvailabilityNotificationSchema
                        .extend({
                            policyId: identifier,
                            policyVersion: identifier,
                            contextProof: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
                            contextRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
                            subscriptions: z
                                .array(
                                    z.strictObject({
                                        channelId: identifier,
                                        channelRevision: revision,
                                    }),
                                )
                                .max(NOTIFICATION_LIMITS.totalChannels)
                                .optional(),
                        })
                        .optional(),
                }),
            )
            .max(NOTIFICATION_LIMITS.incidents),
        deliveries: z
            .array(
                z.strictObject({
                    id: identifier,
                    channelId: identifier,
                    channelRevision: revision,
                    payload,
                    status: z.enum(['pending', 'inflight', 'succeeded', 'failed', 'cancelled']),
                    attempts: z.number().int().min(0).max(NOTIFICATION_LIMITS.attempts),
                    backupAvailableAt: time.optional(),
                    createdAt: time,
                    updatedAt: time,
                    nextAttemptAt: time,
                    leaseToken: identifier.nullable(),
                    leaseExpiresAt: time.nullable(),
                    error: error.nullable(),
                }),
            )
            .max(NOTIFICATION_LIMITS.deliveries),
    })
    .superRefine((state, context) => {
        if (
            new TextEncoder().encode(JSON.stringify(state)).byteLength >
            NOTIFICATION_LIMITS.stateBytes
        )
            context.addIssue({ code: 'custom', message: 'Notification state exceeds size limit' })
        const open = new Set<string>()
        if (
            state.proxyApplyPending &&
            state.proxyApplyPending.observedAt < state.proxyApplyPending.since
        )
            context.addIssue({ code: 'custom', message: 'Invalid proxy apply chronology' })
        const incidentIds = new Set<string>()
        for (const incident of state.incidents) {
            if ((incident.category === 'host_availability') !== Boolean(incident.host))
                context.addIssue({ code: 'custom', message: 'Invalid host incident context' })
            const key = JSON.stringify([incident.category, incident.resourceId])
            if (incidentIds.has(incident.id) || (incident.recoveredAt === null && open.has(key)))
                context.addIssue({ code: 'custom', message: 'Duplicate incident' })
            incidentIds.add(incident.id)
            if (incident.recoveredAt === null) open.add(key)
            if (
                incident.observedAt < incident.startedAt ||
                (incident.recoveredAt !== null && incident.recoveredAt < incident.observedAt) ||
                (incident.recoveredAt === null) !== (incident.recoveryEvidence === null)
            )
                context.addIssue({ code: 'custom', message: 'Invalid incident chronology' })
            const markers = new Set<string>()
            for (const marker of incident.channels) {
                if (markers.has(marker.channelId))
                    context.addIssue({ code: 'custom', message: 'Duplicate channel marker' })
                markers.add(marker.channelId)
            }
        }
        const deliveryIds = new Set<string>()
        const leases = new Set<string>()
        for (const delivery of state.deliveries) {
            if (
                delivery.payload.type !== 'test' &&
                (delivery.payload.category === 'host_availability') !==
                    Boolean(delivery.payload.host)
            )
                context.addIssue({ code: 'custom', message: 'Invalid host delivery context' })
            if (deliveryIds.has(delivery.id) || delivery.id !== delivery.payload.id)
                context.addIssue({ code: 'custom', message: 'Invalid delivery identity' })
            deliveryIds.add(delivery.id)
            if (
                delivery.status === 'inflight'
                    ? delivery.leaseToken === null || delivery.leaseExpiresAt === null
                    : delivery.leaseToken !== null || delivery.leaseExpiresAt !== null
            )
                context.addIssue({ code: 'custom', message: 'Invalid delivery lease' })
            if (delivery.leaseToken !== null) {
                if (leases.has(delivery.leaseToken))
                    context.addIssue({ code: 'custom', message: 'Duplicate delivery lease' })
                leases.add(delivery.leaseToken)
            }
            if (
                delivery.backupAvailableAt !== undefined &&
                (delivery.payload.category !== 'backup' ||
                    delivery.backupAvailableAt < delivery.createdAt ||
                    delivery.backupAvailableAt > delivery.createdAt + 86400 * 1000)
            )
                context.addIssue({
                    code: 'custom',
                    message: 'Invalid backup delivery availability',
                })
            if (
                delivery.updatedAt < delivery.createdAt ||
                new TextEncoder().encode(JSON.stringify(delivery.payload)).byteLength >
                    NOTIFICATION_LIMITS.payloadBytes
            )
                context.addIssue({ code: 'custom', message: 'Invalid delivery bounds' })
        }
    })

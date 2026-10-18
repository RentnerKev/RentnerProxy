import { z } from 'zod'
import {
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_LIMITS,
    NOTIFICATION_SEVERITIES,
} from '@/config/notifications.config.ts'

const notificationIdSchema = z.uuid().regex(/^[a-f0-9-]+$/u)
export const notificationRevisionSchema = z.number().int().min(0).max(4_294_967_295)
export const notificationPolicySchema = z.strictObject({
    id: notificationIdSchema,
    name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[^\p{Cc}\p{Cf}]+$/u),
    kind: z.enum(['email', 'webhook']),
    enabled: z.boolean(),
    events: z
        .array(z.enum(NOTIFICATION_CATEGORIES))
        .min(1)
        .max(NOTIFICATION_CATEGORIES.length)
        .refine((events) => new Set(events).size === events.length),
    minimumSeverity: z.enum(NOTIFICATION_SEVERITIES),
    thresholdSeconds: z.number().int().min(0).max(86_400),
    recovery: z.boolean(),
})

export const notificationDestinationSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('email'),
        recipients: z
            .array(z.email().max(254))
            .min(1)
            .max(16)
            .refine(
                (recipients) =>
                    new Set(recipients.map((email) => email.toLowerCase())).size ===
                    recipients.length,
            ),
    }),
    z.strictObject({
        kind: z.literal('webhook'),
        url: z.string().min(1).max(2_048),
        authorizationToken: z
            .string()
            .regex(/^[\x21-\x7e]{1,2048}$/u)
            .nullable(),
        allowedPrivateCidrs: z.array(z.string().min(3).max(64)).max(16),
    }),
])

export const updateNotificationConfigurationSchema = z
    .strictObject({
        expectedRevision: notificationRevisionSchema,
        enabled: z.boolean(),
        channels: z
            .array(
                notificationPolicySchema
                    .extend({
                        destination: notificationDestinationSchema.optional(),
                    })
                    .superRefine((channel, context) => {
                        if (channel.destination && channel.destination.kind !== channel.kind)
                            context.addIssue({
                                code: 'custom',
                                message: 'Destination kind must match channel',
                            })
                    }),
            )
            .max(NOTIFICATION_LIMITS.channels),
    })
    .superRefine((configuration, context) => {
        if (
            new Set(configuration.channels.map((channel) => channel.id)).size !==
            configuration.channels.length
        )
            context.addIssue({ code: 'custom', message: 'Duplicate channel' })
    })

export const updatePersonalNotificationConfigurationSchema = z
    .strictObject({
        expectedRevision: notificationRevisionSchema,
        channels: updateNotificationConfigurationSchema.shape.channels,
        resumeDelivery: z.boolean().optional(),
    })
    .refine(
        (configuration) =>
            new Set(configuration.channels.map((channel) => channel.id)).size ===
            configuration.channels.length,
        'Duplicate channel',
    )

export const testPersonalNotificationChannelSchema = z.strictObject({
    expectedRevision: notificationRevisionSchema,
    channelId: notificationIdSchema,
})

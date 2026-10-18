import { z } from 'zod'
import { NOTIFICATION_LIMITS } from '@/config/notifications.config.ts'
import {
    notificationPolicySchema,
    notificationRevisionSchema,
} from '@/lib/Notifications/validation.ts'

export const storedNotificationConfigurationSchema = z
    .strictObject({
        version: z.literal(1),
        revision: notificationRevisionSchema,
        enabled: z.boolean(),
        pausedAfterRestore: z.boolean(),
        channels: z
            .array(
                notificationPolicySchema.extend({
                    ownerUserId: z.uuid().optional(),
                    revision: notificationRevisionSchema.refine((value) => value > 0),
                    destination: z.strictObject({
                        ciphertext: z
                            .string()
                            .min(22)
                            .max(65_536)
                            .regex(/^[A-Za-z0-9_-]+$/u),
                        iv: z
                            .string()
                            .length(16)
                            .regex(/^[A-Za-z0-9_-]+$/u),
                    }),
                    hasAuthorization: z.boolean(),
                }),
            )
            .max(NOTIFICATION_LIMITS.totalChannels),
    })
    .superRefine((value, context) => {
        if (value.enabled && value.pausedAfterRestore)
            context.addIssue({
                code: 'custom',
                message: 'Restored notifications must remain paused',
            })
        if (new Set(value.channels.map((channel) => channel.id)).size !== value.channels.length)
            context.addIssue({ code: 'custom', message: 'Duplicate channel' })
        if (value.channels.some((channel) => channel.revision > value.revision))
            context.addIssue({
                code: 'custom',
                message: 'Channel revision exceeds configuration generation',
            })
        const ownerCounts = new Map<string, number>()
        for (const channel of value.channels) {
            const owner = channel.ownerUserId ?? 'global'
            const count = (ownerCounts.get(owner) ?? 0) + 1
            ownerCounts.set(owner, count)
            if (count > NOTIFICATION_LIMITS.channels) {
                context.addIssue({ code: 'custom', message: 'Too many channels for owner' })
                break
            }
        }
    })

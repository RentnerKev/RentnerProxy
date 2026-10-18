import type { z } from 'zod'
import type {
    updateNotificationConfigurationSchema,
    updatePersonalNotificationConfigurationSchema,
    testPersonalNotificationChannelSchema,
} from '../validation.ts'

export type UpdateNotificationConfigurationInput = z.infer<
    typeof updateNotificationConfigurationSchema
>

export type UpdatePersonalNotificationConfigurationInput = z.infer<
    typeof updatePersonalNotificationConfigurationSchema
>
export type TestPersonalNotificationChannelInput = z.infer<
    typeof testPersonalNotificationChannelSchema
>

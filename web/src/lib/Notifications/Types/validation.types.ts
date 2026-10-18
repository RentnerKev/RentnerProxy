import type { z } from 'zod'
import type { updateNotificationConfigurationSchema } from '../validation.ts'

export type UpdateNotificationConfigurationInput = z.infer<
    typeof updateNotificationConfigurationSchema
>

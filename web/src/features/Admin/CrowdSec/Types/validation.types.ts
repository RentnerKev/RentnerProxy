import type { z } from 'zod'

import type {
    updateCrowdSecConfigurationSchema,
    testCrowdSecConnectionSchema,
} from '../validation.ts'

export type UpdateCrowdSecConfigurationInput = z.infer<typeof updateCrowdSecConfigurationSchema>

export type TestCrowdSecConnectionInput = z.infer<typeof testCrowdSecConnectionSchema>

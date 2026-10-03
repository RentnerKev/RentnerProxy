import type { z } from 'zod'

import type { forwardAuthInputSchema, forwardAuthRuntimeSchema } from '../forwardAuth.ts'

export type ForwardAuthConfiguration = z.output<typeof forwardAuthInputSchema>

export type ForwardAuthRuntimeConfiguration = z.output<typeof forwardAuthRuntimeSchema>

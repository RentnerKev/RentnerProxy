import type { z } from 'zod'

import type { createProxyHostInputSchema, updateProxyHostInputSchema } from '../validation.ts'

export type CreateProxyHostInput = z.input<typeof createProxyHostInputSchema>

export type UpdateProxyHostInput = z.input<typeof updateProxyHostInputSchema>

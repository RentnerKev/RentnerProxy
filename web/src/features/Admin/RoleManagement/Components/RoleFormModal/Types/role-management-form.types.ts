import type { z } from 'zod'

import type { createRoleInputSchema } from '../../../validation.ts'

export type RoleEditorFormValues = z.input<typeof createRoleInputSchema>

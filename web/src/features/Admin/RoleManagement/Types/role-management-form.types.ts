import type { z } from 'zod'

import type { createRoleInputSchema } from '../validation'

export type RoleEditorFormValues = z.input<typeof createRoleInputSchema>

import { z } from 'zod'

import { emailSchema } from '@/lib/Auth/validation.ts'

export const forgotPasswordInputSchema = z.object({ email: emailSchema })

import { z } from 'zod'

import { emailSchema } from '../Shared/validation'

export const forgotPasswordInputSchema = z.object({ email: emailSchema })

import type { z } from 'zod'

import type { inviteUserFormSchema, updateUserFormSchema } from '../validation'

export type InviteUserFormValues = z.input<typeof inviteUserFormSchema>
export type UpdateUserFormValues = z.input<typeof updateUserFormSchema>
export type UserFormValues = InviteUserFormValues | UpdateUserFormValues

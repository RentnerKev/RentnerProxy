import type { z } from 'zod'
import type { userAccentColorUpdateSchema } from '@/lib/UserSettings/appearance.ts'

export type UserAccentColorUpdate = z.infer<typeof userAccentColorUpdateSchema>

export interface UserAccentColor {
    readonly userId: string
    readonly accentColor: string
}

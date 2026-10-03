import type { z } from 'zod'
import type { systemAccentColorUpdateSchema } from '@/lib/SystemAppearance/appearance.ts'
export type SystemAccentColorUpdate = z.infer<typeof systemAccentColorUpdateSchema>

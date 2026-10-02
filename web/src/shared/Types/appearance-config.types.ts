import type { z } from 'zod'
import { systemAccentColorUpdateSchema } from '@/lib/SystemAppearance/appearance.ts'
export type SystemAccentColorUpdate = z.infer<typeof systemAccentColorUpdateSchema>

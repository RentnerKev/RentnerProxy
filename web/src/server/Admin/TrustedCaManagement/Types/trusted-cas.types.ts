import type { trustedCas } from '@/db/schema.ts'

export type TrustedCaMutationResult = {
    readonly trustedCaId: string
    readonly runtimeStatus: 'applied' | 'pending'
}

export type TrustedCaRow = typeof trustedCas.$inferSelect

import type { accessPolicyBasicAuthAccounts } from '@/db/schema.ts'

export interface BasicAuthAccountSummary {
    readonly id: string
    readonly accessPolicyId: string
    readonly username: string
    readonly createdAt: Date
    readonly updatedAt: Date
}

export interface BasicAuthMutationResult {
    readonly accountId: string
    readonly runtimeStatus: 'applied' | 'pending'
}

export type BasicAuthAccountRow = typeof accessPolicyBasicAuthAccounts.$inferSelect

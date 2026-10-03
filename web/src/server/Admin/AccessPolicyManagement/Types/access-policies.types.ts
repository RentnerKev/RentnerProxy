import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'

import type { accessPolicies } from '@/db/schema.ts'

export type AccessPolicyMutationResult = AccessPolicySummary & {
    readonly accessPolicyId: string
    readonly runtimeStatus: 'applied' | 'pending'
}

export type AccessPolicyRow = typeof accessPolicies.$inferSelect

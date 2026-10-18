import type { ImportPreviewItem } from '@/lib/Imports/Types/import.types.ts'

import type { CreateProxyHostInput } from '@/features/Admin/ProxyHostManagement/Types/validation.types.ts'

import type { CreateRedirectHostInput } from '@/features/Admin/RedirectHostManagement/Types/validation.types.ts'

import type { CreateAccessPolicyInput } from '@/features/Admin/AccessPolicyManagement/Types/validation.types.ts'

export interface NpmImportPlanItem extends ImportPreviewItem {
    readonly proxyInput?: CreateProxyHostInput
    readonly redirectInput?: CreateRedirectHostInput
    readonly policyInput?: CreateAccessPolicyInput
    readonly accessListId?: number
}

export interface NpmImportPlan {
    readonly fingerprint: string
    readonly sourceSchema: string
    readonly items: readonly NpmImportPlanItem[]
}

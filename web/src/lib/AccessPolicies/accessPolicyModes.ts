import { ACCESS_POLICY_MODES, ACCESS_POLICY_COMBINATIONS } from '@/config/access-policies.config.ts'
import type {
    AccessPolicyMode,
    AccessPolicyCombination,
} from '@/config/Types/access-policies-config.types.ts'
export function isAccessPolicyMode(value: string): value is AccessPolicyMode {
    return (ACCESS_POLICY_MODES as readonly string[]).includes(value)
}

export function isAccessPolicyCombination(value: string): value is AccessPolicyCombination {
    return (ACCESS_POLICY_COMBINATIONS as readonly string[]).includes(value)
}

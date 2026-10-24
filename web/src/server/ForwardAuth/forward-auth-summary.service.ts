import '@tanstack/react-start/server-only'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import type { ForwardAuthSummary } from '@/lib/ForwardAuth/Types/forward-auth-summary.types.ts'
import { getAccessPoliciesService } from '@/server/Admin/AccessPolicyManagement/access-policies.service.ts'
import { getProxyRuntimeStatusService } from '@/server/ProxyRuntime/proxy-runtime.service.ts'

export async function getForwardAuthSummaryService(): Promise<ForwardAuthSummary> {
    const [policies, runtime] = await Promise.all([
        getAccessPoliciesService(),
        getProxyRuntimeStatusService(PERMISSIONS.ACCESS_POLICIES_VIEW),
    ])
    const forwardAuthPolicies = policies.filter((policy) => policy.forwardAuth !== null)
    return {
        policyCount: forwardAuthPolicies.length,
        assignedHosts: forwardAuthPolicies.reduce(
            (total, policy) => total + policy.assignedHostCount,
            0,
        ),
        runtimeState: runtime.state,
    }
}

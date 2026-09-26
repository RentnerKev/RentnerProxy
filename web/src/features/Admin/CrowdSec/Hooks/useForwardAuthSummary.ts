import { useQuery } from '@tanstack/react-query'

import { accessPolicyManagementQueryKeys } from '../../AccessPolicyManagement/queryKeys'
import {
    getAccessPoliciesHandler,
    getAccessPolicyRuntimeStatusHandler,
} from '../../AccessPolicyManagement/server'

export default function useForwardAuthSummary() {
    const policies = useQuery({
        queryKey: accessPolicyManagementQueryKeys.all,
        queryFn: () => getAccessPoliciesHandler(),
        refetchInterval: 10_000,
    })
    const runtime = useQuery({
        queryKey: accessPolicyManagementQueryKeys.runtimeStatus,
        queryFn: () => getAccessPolicyRuntimeStatusHandler(),
        refetchInterval: 10_000,
    })
    const forwardAuthPolicies = policies.data?.filter((policy) => policy.forwardAuth !== null)
    const assignedHosts = forwardAuthPolicies?.reduce(
        (total, policy) => total + policy.assignedHostCount,
        0,
    )
    const runtimeState = runtime.isError ? 'unavailable' : runtime.data?.state

    return { policies, runtime, forwardAuthPolicies, assignedHosts, runtimeState }
}

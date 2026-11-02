import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type { ProxyHostUpstreamHealth } from '@/lib/ProxyRuntime/Types/upstream-health.types.ts'

export interface UpstreamAvailabilityProps {
    readonly host: ProxyHostSummary
    readonly open: boolean
}
export interface UpstreamAvailabilityLogicResult {
    state: {
        visible: boolean
        availability: ProxyHostUpstreamHealth['state']
        reason: 'disabled' | 'loading' | 'error' | 'unknown' | null
        members: ReadonlyArray<{
            index: number
            target: string
            state: ProxyHostUpstreamHealth['members'][number]['state']
        }>
    }
}

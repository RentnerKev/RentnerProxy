import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'
import type {
    DiscoveryRow,
    DiscoveryCandidate,
} from '@/lib/DockerDiscovery/Types/management.types.ts'
import type { CreateProxyHostInput } from '@/features/Admin/ProxyHostManagement/Types/validation.types.ts'

export interface DiscoveryInventory {
    readonly hosts: readonly ProxyHostSummary[]
    readonly domains: readonly { domain: string; proxyHostId: string | null }[]
    readonly rejections?: Readonly<Record<string, 'reference_invalid' | 'authorization_required'>>
}
export interface DiscoveryPlan {
    readonly settled: readonly string[]
    readonly rows: readonly DiscoveryRow[]
    readonly previewToken: string
    readonly changes: readonly {
        key: string
        candidate: DiscoveryCandidate
        host: ProxyHostSummary | null
        input: CreateProxyHostInput
    }[]
}

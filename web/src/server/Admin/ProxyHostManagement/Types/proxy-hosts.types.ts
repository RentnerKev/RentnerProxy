import type { ProxyHostSummary } from '@/lib/Admin/ProxyHostManagement/Types/proxy-hosts.types.ts'

import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

export type ProxyHostMutationSummary = ProxyHostSummary & {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

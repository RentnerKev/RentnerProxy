import type { RedirectHostSummary } from '@/lib/Admin/RedirectHostManagement/Types/redirect-hosts.types.ts'

import type { ProxyRuntimeMutationStatus } from '@/lib/ProxyRuntime/Types/proxy-runtime.types.ts'

import type { RedirectHostStatusCode } from '@/config/Types/redirect-hosts-config.types.ts'

export type RedirectHostMutationSummary = RedirectHostSummary & {
    readonly runtimeStatus: ProxyRuntimeMutationStatus
}

export type RedirectHostRow = {
    id: string
    destination: string
    statusCode: RedirectHostStatusCode
    preserveRequestUri: boolean
    enabled: boolean
    certificateId: string | null
    createdAt: Date
    updatedAt: Date
}

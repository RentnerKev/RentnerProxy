import type { ProxyUpstreamPool } from '@/lib/ProxyRuntime/Types/upstream-pool.types.ts'
export type ProxyHostRow = {
    upstreamPool?: ProxyUpstreamPool | null | undefined

    id: string
    forwardScheme: 'http' | 'https'
    forwardHost: string
    forwardPort: number
    enabled: boolean
    certificateId: string | null
    forceHttps: boolean
    verifyUpstreamTls: boolean
    upstreamTlsServerName: string | null
    trustedCaId: string | null
    accessPolicyId?: string | null
    createdAt: Date
    updatedAt: Date
}

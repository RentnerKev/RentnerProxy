import type { z } from 'zod'
import type {
    proxyUpstreamMemberSchema,
    proxyUpstreamPoolSchema,
    proxyUpstreamFailoverSchema,
} from '../upstreamPool.ts'

export type ProxyUpstreamMember = z.infer<typeof proxyUpstreamMemberSchema>
export type ProxyUpstreamPool = z.infer<typeof proxyUpstreamPoolSchema>

export type ProxyUpstreamFailover = z.infer<typeof proxyUpstreamFailoverSchema>

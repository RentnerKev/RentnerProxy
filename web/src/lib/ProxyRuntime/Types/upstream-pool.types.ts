import type { z } from 'zod'
import type { proxyUpstreamMemberSchema, proxyUpstreamPoolSchema } from '../upstreamPool.ts'

export type ProxyUpstreamMember = z.infer<typeof proxyUpstreamMemberSchema>
export type ProxyUpstreamPool = z.infer<typeof proxyUpstreamPoolSchema>

import { z } from 'zod'
import {
    MAX_PROXY_UPSTREAM_MEMBERS,
    PROXY_UPSTREAM_POLICIES,
} from '@/config/upstream-pools.config.ts'
import { normalizeForwardHost } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'

export const proxyUpstreamMemberSchema = z.strictObject({
    host: z
        .string()
        .max(1_024, 'admin.proxyHosts.validation.forwardHost')
        .transform((value, context) => {
            const host = normalizeForwardHost(value)
            if (host === null) {
                context.addIssue({
                    code: 'custom',
                    message: 'admin.proxyHosts.validation.forwardHost',
                })
                return z.NEVER
            }
            return host
        }),
    port: z
        .number('admin.proxyHosts.validation.port')
        .int('admin.proxyHosts.validation.port')
        .min(1, 'admin.proxyHosts.validation.port')
        .max(65_535, 'admin.proxyHosts.validation.port'),
})

export const proxyUpstreamPoolSchema = z
    .strictObject({
        policy: z.enum(PROXY_UPSTREAM_POLICIES),
        members: z
            .array(proxyUpstreamMemberSchema)
            .min(1, 'admin.proxyHosts.validation.upstreamMembersRequired')
            .max(MAX_PROXY_UPSTREAM_MEMBERS, 'admin.proxyHosts.validation.upstreamMembersLimit'),
    })
    .superRefine(validateUniqueUpstreamMembers)

export function validateUniqueUpstreamMembers(
    pool: { members: readonly { host: string; port: number }[] },
    context: z.RefinementCtx,
): void {
    const seen = new Set<string>()
    for (const [index, member] of pool.members.entries()) {
        const key = JSON.stringify([member.host, member.port])
        if (seen.has(key))
            context.addIssue({
                code: 'custom',
                path: ['members', index],
                message: 'admin.proxyHosts.validation.duplicateUpstream',
            })
        seen.add(key)
    }
}

export function upstreamTlsRequiresServerName(hosts: readonly string[]): boolean {
    return hosts.some(
        (host) => z.ipv4().safeParse(host).success || z.ipv6().safeParse(host).success,
    )
}

import { z } from 'zod'
import {
    MAX_PROXY_UPSTREAM_MEMBERS,
    PROXY_UPSTREAM_POLICIES,
} from '@/config/upstream-pools.config.ts'
import { normalizeForwardHost } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'

/** Validates a strict host/port pair and canonicalizes DNS and IP host notation. */
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

const failoverError = 'admin.proxyHosts.validation.upstreamFailover'
/**
 * Accepts a bounded origin-form probe target, including a query string.
 * Paths must use printable ASCII and complete percent escapes; network-path
 * references, fragments, backslashes and Caddy placeholders are rejected.
 */
export const proxyUpstreamHealthPathSchema = z
    .string()
    .min(1, failoverError)
    .max(2_048, failoverError)
    .refine(
        (path) =>
            path.startsWith('/') &&
            !path.startsWith('//') &&
            !/[^\x21-\x7e]|[#\\{}]|%(?![0-9a-fA-F]{2})/u.test(path),
        failoverError,
    )
/**
 * Validates explicit probe timing, consecutive failure/recovery thresholds and
 * expected 2xx/3xx status. Field order also defines canonical failover JSON.
 */
export const proxyUpstreamActiveHealthSchema = z
    .strictObject({
        path: proxyUpstreamHealthPathSchema,
        intervalSeconds: z
            .number(failoverError)
            .int(failoverError)
            .min(5, failoverError)
            .max(300, failoverError),
        timeoutSeconds: z
            .number(failoverError)
            .int(failoverError)
            .min(1, failoverError)
            .max(30, failoverError),
        fails: z
            .number(failoverError)
            .int(failoverError)
            .min(1, failoverError)
            .max(10, failoverError),
        passes: z
            .number(failoverError)
            .int(failoverError)
            .min(1, failoverError)
            .max(10, failoverError),
        expectedStatus: z
            .number(failoverError)
            .int(failoverError)
            .min(200, failoverError)
            .max(399, failoverError),
    })
    .superRefine(validateActiveHealth)
/**
 * Bounds the passive failure window and exclusion threshold.
 * Unhealthy response statuses remain fixed by the runtime rather than user input.
 */
export const proxyUpstreamPassiveHealthSchema = z.strictObject({
    failDurationSeconds: z
        .number(failoverError)
        .int(failoverError)
        .min(1, failoverError)
        .max(300, failoverError),
    maxFails: z
        .number(failoverError)
        .int(failoverError)
        .min(1, failoverError)
        .max(10, failoverError),
})
/** Validates opt-in retry count and timing budgets with explicit seconds/milliseconds units. */
export const proxyUpstreamRetriesSchema = z
    .strictObject({
        maxRetries: z
            .number(failoverError)
            .int(failoverError)
            .min(1, failoverError)
            .max(15, failoverError),
        tryDurationSeconds: z
            .number(failoverError)
            .int(failoverError)
            .min(1, failoverError)
            .max(30, failoverError),
        tryIntervalMilliseconds: z
            .number(failoverError)
            .int(failoverError)
            .min(100, failoverError)
            .max(5_000, failoverError),
    })
    .superRefine(validateRetries)
/**
 * Requires at least one explicit failover block and preserves omitted options.
 * Retries depend on passive accounting; canonical blocks stay active/passive/retries.
 */
export const proxyUpstreamFailoverSchema = z
    .strictObject({
        active: proxyUpstreamActiveHealthSchema.optional(),
        passive: proxyUpstreamPassiveHealthSchema.optional(),
        retries: proxyUpstreamRetriesSchema.optional(),
    })
    .superRefine(validateFailover)

/** Keeps a probe timeout within its interval after individual timing bounds are validated. */
export function validateActiveHealth(
    value: { timeoutSeconds: number; intervalSeconds: number },
    context: z.RefinementCtx,
): void {
    if (value.timeoutSeconds > value.intervalSeconds)
        context.addIssue({ code: 'custom', path: ['timeoutSeconds'], message: failoverError })
}
/** Rejects retry intervals exceeding the total retry budget, converting seconds to milliseconds. */
export function validateRetries(
    value: { tryIntervalMilliseconds: number; tryDurationSeconds: number },
    context: z.RefinementCtx,
): void {
    if (value.tryIntervalMilliseconds > value.tryDurationSeconds * 1_000)
        context.addIssue({
            code: 'custom',
            path: ['tryIntervalMilliseconds'],
            message: failoverError,
        })
}
/**
 * Rejects empty failover settings and retries without passive failure accounting,
 * so failed members can become ineligible before another target is selected.
 */
export function validateFailover(
    value: { active?: unknown; passive?: unknown; retries?: unknown },
    context: z.RefinementCtx,
): void {
    if (!value.active && !value.passive && !value.retries)
        context.addIssue({ code: 'custom', message: failoverError })
    if (value.retries && !value.passive)
        context.addIssue({ code: 'custom', path: ['retries'], message: failoverError })
}
/**
 * Requires first-policy retry budgets to reach the passive exclusion threshold.
 * This prevents an explicitly configured retry budget from being exhausted while
 * first selection continues choosing the same failing primary member.
 */
export function validatePoolRetries(
    value: {
        policy: string
        failover?:
            | {
                  passive?: { maxFails: number } | undefined
                  retries?: { maxRetries: number } | undefined
              }
            | undefined
    },
    context: z.RefinementCtx,
): void {
    if (
        value.policy === 'first' &&
        value.failover?.retries &&
        value.failover.passive &&
        value.failover.retries.maxRetries < value.failover.passive.maxFails
    ) {
        context.addIssue({
            code: 'custom',
            path: ['failover', 'retries', 'maxRetries'],
            message: failoverError,
        })
    }
}

/**
 * Validates a bounded, ordered pool with an explicit selection policy.
 * Extra member options are rejected and duplicate canonical targets are invalid.
 * Optional failover stays explicit and also enforces policy-specific retry bounds.
 */
export const proxyUpstreamPoolSchema = z
    .strictObject({
        policy: z.enum(PROXY_UPSTREAM_POLICIES),
        members: z
            .array(proxyUpstreamMemberSchema)
            .min(1, 'admin.proxyHosts.validation.upstreamMembersRequired')
            .max(MAX_PROXY_UPSTREAM_MEMBERS, 'admin.proxyHosts.validation.upstreamMembersLimit'),
        failover: proxyUpstreamFailoverSchema.optional(),
    })
    .superRefine(validateUniqueUpstreamMembers)
    .superRefine(validatePoolRetries)

/**
 * Adds an issue at each repeated canonical host/port pair without reordering it.
 * Host normalization must run first so equivalent DNS or IP spellings collide.
 */
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

/**
 * Reports whether the shared TLS policy covers any IP target.
 * Callers require a DNS identity override for verified HTTPS in that case;
 * distinct DNS targets can otherwise use their own automatic TLS identities.
 */
export function upstreamTlsRequiresServerName(hosts: readonly string[]): boolean {
    return hosts.some(
        (host) => z.ipv4().safeParse(host).success || z.ipv6().safeParse(host).success,
    )
}

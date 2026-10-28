import { z } from 'zod'
import { normalizeProxyDomain } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'

const revision = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
const domain = z
    .string()
    .min(1)
    .max(253)
    .refine((value) => {
        const base = value.startsWith('*.') ? value.slice(2) : value
        return normalizeProxyDomain(base) === base
    })
export const domainDiagnosticsInputSchema = z.strictObject({
    hostType: z.enum(['proxy', 'redirect']),
    hostId: z.uuid().refine((value) => value === value.toLowerCase()),
    domain,
})
export const domainDiagnosticsControllerInputSchema = domainDiagnosticsInputSchema.extend({
    expectedRevision: revision,
})
const status = z.enum(['passed', 'failed', 'unknown', 'not_applicable'])
const stage = z.strictObject({
    status,
    code: z.enum([
        'configuration_active',
        'configuration_stale',
        'configuration_changed',
        'host_not_active',
        'runtime_unavailable',
        'skipped',
        'dns_resolved',
        'dns_not_found',
        'dns_failed',
        'dns_timeout',
        'wildcard_domain',
        'upstream_responded',
        'upstream_unreachable',
        'upstream_timeout',
        'upstream_dns_failed',
        'access_denied',
        'upstream_error',
        'redirect_not_followed',
        'unexpected_status',
        'tls_verified',
        'tls_verification_disabled',
        'tls_failed',
        'tls_unconfirmed',
        'http_upstream',
        'redirect_host',
    ]),
    durationMs: z.number().int().min(0).max(12_000),
    addresses: z
        .array(z.union([z.ipv4(), z.ipv6()]))
        .max(16)
        .refine((values) => new Set(values).size === values.length),
    httpStatus: z.number().int().min(100).max(599).nullable(),
})
const statusByCode = {
    configuration_active: 'passed',
    configuration_stale: 'unknown',
    configuration_changed: 'unknown',
    host_not_active: 'unknown',
    runtime_unavailable: 'unknown',
    skipped: 'unknown',
    dns_resolved: 'passed',
    dns_not_found: 'failed',
    dns_failed: 'failed',
    dns_timeout: 'failed',
    wildcard_domain: 'not_applicable',
    upstream_responded: 'passed',
    upstream_unreachable: 'failed',
    upstream_timeout: 'failed',
    upstream_dns_failed: 'failed',
    access_denied: 'failed',
    upstream_error: 'failed',
    redirect_not_followed: 'unknown',
    unexpected_status: 'unknown',
    tls_verified: 'passed',
    tls_verification_disabled: 'unknown',
    tls_failed: 'failed',
    tls_unconfirmed: 'unknown',
    http_upstream: 'not_applicable',
    redirect_host: 'not_applicable',
} as const
const stageCodes = {
    configuration: [
        'configuration_active',
        'configuration_stale',
        'configuration_changed',
        'host_not_active',
        'runtime_unavailable',
    ],
    dns: [
        'dns_resolved',
        'dns_not_found',
        'dns_failed',
        'dns_timeout',
        'wildcard_domain',
        'skipped',
    ],
    upstream: [
        'upstream_responded',
        'upstream_unreachable',
        'upstream_timeout',
        'upstream_dns_failed',
        'access_denied',
        'upstream_error',
        'redirect_not_followed',
        'unexpected_status',
        'redirect_host',
        'wildcard_domain',
        'skipped',
    ],
    tls: [
        'tls_verified',
        'tls_verification_disabled',
        'tls_failed',
        'tls_unconfirmed',
        'http_upstream',
        'redirect_host',
        'wildcard_domain',
        'skipped',
    ],
} as const
export const domainDiagnosticsResultSchema = domainDiagnosticsControllerInputSchema
    .extend({
        activeRevision: revision.nullable(),
        checkedAt: z.iso.datetime().refine((value) => value.endsWith('Z')),
        observationPoint: z.literal('appliance'),
        publicReachability: z.literal('not_checked'),
        stages: z.strictObject({ configuration: stage, dns: stage, upstream: stage, tls: stage }),
    })
    .superRefine((value, context) => {
        const fail = () =>
            context.addIssue({ code: 'custom', message: 'Invalid diagnostic result.' })
        for (const name of ['configuration', 'dns', 'upstream', 'tls'] as const) {
            const item = value.stages[name]
            if (
                !(stageCodes[name] as readonly string[]).includes(item.code) ||
                item.status !== statusByCode[item.code]
            )
                fail()
            if (name !== 'dns' && item.addresses.length) fail()
            if (name !== 'upstream' && item.httpStatus !== null) fail()
        }
        const { configuration, dns, upstream, tls } = value.stages
        if ((dns.code === 'dns_resolved') !== dns.addresses.length > 0) fail()
        const code = upstream.code,
            http = upstream.httpStatus
        const expectedHttpCode =
            http === null
                ? null
                : http >= 200 && http < 300
                  ? 'upstream_responded'
                  : http >= 300 && http < 400
                    ? 'redirect_not_followed'
                    : http === 401 || http === 403
                      ? 'access_denied'
                      : http >= 500
                        ? 'upstream_error'
                        : 'unexpected_status'
        if (
            http !== null
                ? code !== expectedHttpCode
                : [
                      'upstream_responded',
                      'redirect_not_followed',
                      'access_denied',
                      'upstream_error',
                      'unexpected_status',
                  ].includes(code)
        )
            fail()
        if (configuration.code === 'configuration_active') {
            if (value.activeRevision !== value.expectedRevision) fail()
            if (value.domain.startsWith('*.')) {
                if ([dns, upstream, tls].some((item) => item.code !== 'wildcard_domain')) fail()
            } else if (value.hostType === 'redirect') {
                if (upstream.code !== 'redirect_host' || tls.code !== 'redirect_host') fail()
            } else if (
                [upstream, tls].some(
                    (item) => item.code === 'redirect_host' || item.code === 'wildcard_domain',
                )
            )
                fail()
        } else if ([dns, upstream, tls].some((item) => item.code !== 'skipped')) fail()
        if (tls.code === 'tls_verified' && http === null) fail()
    })

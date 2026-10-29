import { z } from 'zod'
import { normalizeProxyDomain } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'

export const dockerDiscoveryErrors = [
    'invalid_input',
    'conflict',
    'store_unavailable',
    'endpoint_unavailable',
    'invalid_response',
    'inventory_too_large',
    'stopping',
    'controller_unavailable',
] as const
export const dockerDiscoveryIssues = [
    'invalid_domains',
    'unsupported_label',
    'missing_port',
    'ambiguous_port',
    'invalid_port',
    'invalid_protocol',
    'missing_network',
    'ambiguous_network',
    'invalid_network',
    'unsupported_network_mode',
    'missing_address',
    'invalid_certificate_reference',
    'invalid_access_policy_reference',
    'container_not_running',
    'domain_conflict',
    'unsupported_orchestrator',
    'invalid_source',
    'source_conflict',
    'invalid_upstream_tls_name',
] as const
export const dockerEndpointSchema = z
    .string()
    .max(512)
    .refine((value) => {
        if (value.startsWith('unix:')) {
            const path = value.slice('unix://'.length)
            return (
                value.startsWith('unix:///') &&
                value === value.trim() &&
                !/[\\?#%]/u.test(value) &&
                Array.from(value).every((character) => {
                    const code = character.charCodeAt(0)
                    return code >= 32 && (code < 127 || code > 159)
                }) &&
                path
                    .split('/')
                    .slice(1)
                    .every((part) => part !== '' && part !== '.' && part !== '..')
            )
        }
        try {
            const url = new URL(value)
            return (
                value === value.trim() &&
                !/[\\\r\n\t]/u.test(value) &&
                ['http:', 'https:'].includes(url.protocol) &&
                Boolean(url.hostname) &&
                !url.username &&
                !url.password &&
                url.pathname === '/' &&
                !value.includes('?') &&
                !value.includes('#') &&
                url.port !== '0'
            )
        } catch {
            return false
        }
    })
const dockerDiscoveryConfigurationSchema = z
    .strictObject({
        enabled: z.boolean(),
        endpoint: dockerEndpointSchema.nullable(),
    })
    .refine((value) => !value.enabled || value.endpoint !== null)
const revisionSchema = z.number().int().min(0).max(4_294_967_295)
export const saveDockerDiscoverySchema = z.strictObject({
    expectedRevision: revisionSchema,
    configuration: dockerDiscoveryConfigurationSchema,
    acknowledgeRestore: z.boolean(),
})
export const dockerDiscoverySnapshotSchema = z.strictObject({
    configuration: z.strictObject({
        version: z.literal(1),
        revision: revisionSchema,
        settings: dockerDiscoveryConfigurationSchema,
    }),
    status: z.enum(['disabled', 'paused', 'connecting', 'ready', 'unavailable']),
    stale: z.boolean(),
    error: z.enum(dockerDiscoveryErrors).nullable(),
    candidates: z
        .array(
            z.strictObject({
                containerId: z.string().regex(/^[a-f0-9]{64}$/u),
                sourceId: z.string().min(1).max(265).nullable(),
                domains: z
                    .array(
                        z
                            .string()
                            .min(1)
                            .max(253)
                            .refine((value) => normalizeProxyDomain(value) === value),
                    )
                    .max(100),
                target: z
                    .strictObject({
                        scheme: z.enum(['http', 'https']),
                        address: z.union([z.ipv4(), z.ipv6()]),
                        port: z.number().int().min(1).max(65535),
                        network: z.string().min(1).max(128),
                    })
                    .nullable(),
                certificateId: z.uuidv7().nullable(),
                accessPolicyId: z.uuidv7().nullable(),
                upstreamTlsServerName: z.string().max(253).nullable(),
                issues: z.array(z.enum(dockerDiscoveryIssues)).max(20),
            }),
        )
        .max(256),
})

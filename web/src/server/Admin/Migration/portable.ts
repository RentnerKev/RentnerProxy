// oxlint-disable-next-line import/no-unassigned-import -- Portable exports and imports must stay server-side.
import '@tanstack/react-start/server-only'

import { readFile } from 'node:fs/promises'

import { asc } from 'drizzle-orm'
import { z } from 'zod'

import { PERMISSIONS } from '@/config/permissions.config.ts'
import { accessPolicies, hostDomains, proxyHosts, redirectHosts } from '@/db/schema.ts'
import { createAccessPolicyInputSchema } from '@/features/Admin/AccessPolicyManagement/validation.ts'
import {
    createProxyHostInputSchema,
    proxyHostDomainsSchema,
} from '@/features/Admin/ProxyHostManagement/validation.ts'
import { createRedirectHostInputSchema } from '@/features/Admin/RedirectHostManagement/validation.ts'
import { requirePermissionService } from '@/server/Auth/Access/authorization.service.ts'
import { getAuthDatabase } from '@/server/Auth/Core/database.server.ts'
import type { NpmImportPlan, NpmImportPlanItem } from '@/server/Admin/NpmImport/npm-plan.ts'
import { finalizeImportPlan } from './import-plan.ts'

export const PORTABLE_MAX_BYTES = 4 * 1024 * 1024
const MAX_OBJECTS = 500
export const PORTABLE_SCHEMA = 'rentnerproxy-portable-v1'

const recordSchema = z.record(z.string(), z.unknown())
const documentSchema = z.strictObject({
    format: z.literal('rentnerproxy-portable-config'),
    version: z.literal(1),
    exportedAt: z.iso.datetime(),
    policies: z.array(recordSchema).max(MAX_OBJECTS),
    proxyHosts: z.array(recordSchema).max(MAX_OBJECTS),
    redirectHosts: z.array(recordSchema).max(MAX_OBJECTS),
})
const policySchema = z.strictObject({
    id: z.uuid(),
    name: z.string(),
    description: z.string(),
    mode: z.enum(['public', 'ip-restricted', 'authenticated', 'combined']),
    ipRules: z.unknown().nullable(),
})
const proxySchema = z.strictObject({
    id: z.uuid(),
    domains: proxyHostDomainsSchema,
    forwardScheme: z.enum(['http', 'https']),
    forwardHost: z.string(),
    forwardPort: z.number().int(),
    enabled: z.boolean(),
    forceHttps: z.boolean(),
    verifyUpstreamTls: z.boolean(),
    upstreamTlsServerName: z.string().nullable(),
    accessPolicyId: z.uuid().nullable(),
    certificateRequired: z.boolean(),
    trustedCaRequired: z.boolean(),
})
const redirectSchema = z.strictObject({
    id: z.uuid(),
    domains: proxyHostDomainsSchema,
    destination: z.string(),
    statusCode: z.number().int(),
    preserveRequestUri: z.boolean(),
    enabled: z.boolean(),
    certificateRequired: z.boolean(),
})

export class PortableSourceError extends Error {
    constructor(readonly code: 'invalid_source' | 'unsupported_schema' | 'source_limit') {
        super(code)
    }
}

type PolicyExportRow = Pick<
    typeof accessPolicies.$inferSelect,
    'id' | 'name' | 'description' | 'mode' | 'ipRules'
>
type ProxyExportRow = Pick<
    typeof proxyHosts.$inferSelect,
    | 'id'
    | 'forwardScheme'
    | 'forwardHost'
    | 'forwardPort'
    | 'enabled'
    | 'forceHttps'
    | 'verifyUpstreamTls'
    | 'upstreamTlsServerName'
    | 'accessPolicyId'
    | 'certificateId'
    | 'trustedCaId'
>
type RedirectExportRow = Pick<
    typeof redirectHosts.$inferSelect,
    'id' | 'destination' | 'statusCode' | 'preserveRequestUri' | 'enabled' | 'certificateId'
>
type DomainExportRow = Pick<
    typeof hostDomains.$inferSelect,
    'domain' | 'proxyHostId' | 'redirectHostId'
>

export function buildPortableDocument(
    policies: readonly PolicyExportRow[],
    proxies: readonly ProxyExportRow[],
    redirects: readonly RedirectExportRow[],
    domains: readonly DomainExportRow[],
) {
    const domainMap = new Map<string, string[]>()
    for (const domain of domains) {
        const id = domain.proxyHostId ?? domain.redirectHostId
        if (!id) continue
        const current = domainMap.get(id) ?? []
        current.push(domain.domain)
        domainMap.set(id, current)
    }
    return {
        format: 'rentnerproxy-portable-config' as const,
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        policies: policies.map((policy) => ({
            id: policy.id,
            name: policy.name,
            description: policy.description,
            mode: policy.mode,
            ipRules: policy.mode === 'ip-restricted' ? policy.ipRules : null,
        })),
        proxyHosts: proxies.map((host) => ({
            id: host.id,
            domains: (domainMap.get(host.id) ?? []).toSorted(),
            forwardScheme: host.forwardScheme,
            forwardHost: host.forwardHost,
            forwardPort: host.forwardPort,
            enabled: host.enabled,
            forceHttps: host.forceHttps,
            verifyUpstreamTls: host.verifyUpstreamTls,
            upstreamTlsServerName: host.upstreamTlsServerName,
            accessPolicyId: host.accessPolicyId,
            certificateRequired: host.certificateId !== null,
            trustedCaRequired: host.trustedCaId !== null,
        })),
        redirectHosts: redirects.map((host) => ({
            id: host.id,
            domains: (domainMap.get(host.id) ?? []).toSorted(),
            destination: host.destination,
            statusCode: host.statusCode,
            preserveRequestUri: host.preserveRequestUri,
            enabled: host.enabled,
            certificateRequired: host.certificateId !== null,
        })),
    }
}

export async function exportPortableConfiguration(): Promise<string> {
    await requirePermissionService(PERMISSIONS.MIGRATION)
    const document = await getAuthDatabase().transaction(
        async (transaction) => {
            const policies = await transaction
                .select()
                .from(accessPolicies)
                .orderBy(asc(accessPolicies.id))
                .limit(MAX_OBJECTS + 1)
            const proxies = await transaction
                .select()
                .from(proxyHosts)
                .orderBy(asc(proxyHosts.id))
                .limit(MAX_OBJECTS + 1)
            const redirects = await transaction
                .select()
                .from(redirectHosts)
                .orderBy(asc(redirectHosts.id))
                .limit(MAX_OBJECTS + 1)
            const domains = await transaction
                .select()
                .from(hostDomains)
                .orderBy(asc(hostDomains.domain))
                .limit(MAX_OBJECTS * 20 + 1)
            if (
                policies.length > MAX_OBJECTS ||
                proxies.length > MAX_OBJECTS ||
                redirects.length > MAX_OBJECTS ||
                policies.length + proxies.length + redirects.length > MAX_OBJECTS ||
                domains.length > MAX_OBJECTS * 20
            ) {
                throw new PortableSourceError('source_limit')
            }
            return buildPortableDocument(policies, proxies, redirects, domains)
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    const json = JSON.stringify(document, null, 2) + '\n'
    if (Buffer.byteLength(json) > PORTABLE_MAX_BYTES) throw new PortableSourceError('source_limit')
    return json
}

export async function readPortableSource(path: string): Promise<z.infer<typeof documentSchema>> {
    const bytes = await readFile(path)
    if (bytes.byteLength > PORTABLE_MAX_BYTES) throw new PortableSourceError('source_limit')
    let parsed: unknown
    try {
        parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
        throw new PortableSourceError('invalid_source')
    }
    if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as Record<string, unknown>).format !== 'rentnerproxy-portable-config' ||
        (parsed as Record<string, unknown>).version !== 1
    ) {
        throw new PortableSourceError('unsupported_schema')
    }
    const document = documentSchema.safeParse(parsed)
    if (!document.success) throw new PortableSourceError('invalid_source')
    if (
        document.data.policies.length +
            document.data.proxyHosts.length +
            document.data.redirectHosts.length >
        MAX_OBJECTS
    ) {
        throw new PortableSourceError('source_limit')
    }
    return document.data
}

function manual(
    kind: NpmImportPlanItem['kind'],
    sourceId: number,
    label: string,
    reason: string,
    domains: readonly string[] = [],
): NpmImportPlanItem {
    return { kind, sourceId, label, domains, status: 'manual', reasons: [reason] }
}

export function buildPortablePlan(
    source: Awaited<ReturnType<typeof readPortableSource>>,
    fingerprint: string,
    existingDomains: ReadonlyMap<string, string>,
): NpmImportPlan {
    const policyIds = new Map<string, number>()
    const policyCounts = new Map<string, number>()
    for (const raw of source.policies) {
        if (typeof raw.id === 'string')
            policyCounts.set(raw.id, (policyCounts.get(raw.id) ?? 0) + 1)
    }
    const policies = source.policies.map((raw, index): NpmImportPlanItem => {
        const sourceId = index + 1
        const parsed = policySchema.safeParse(raw)
        const label = typeof raw.name === 'string' ? raw.name.slice(0, 120) : `Policy #${sourceId}`
        if (!parsed.success) return manual('access-policy', sourceId, label, 'invalid_access_list')
        if ((policyCounts.get(parsed.data.id) ?? 0) !== 1) {
            return manual('access-policy', sourceId, label, 'duplicate_source_id')
        }
        policyIds.set(parsed.data.id, sourceId)
        if (parsed.data.mode !== 'public' && parsed.data.mode !== 'ip-restricted') {
            return manual('access-policy', sourceId, label, 'auth_policy_manual')
        }
        if ((parsed.data.mode === 'public') !== (parsed.data.ipRules === null)) {
            return manual('access-policy', sourceId, label, 'invalid_ip_rules')
        }
        const input = createAccessPolicyInputSchema.safeParse({
            name: parsed.data.name,
            description: parsed.data.description,
            mode: parsed.data.mode,
            combination: null,
            ipRules: parsed.data.ipRules,
            forwardAuth: null,
        })
        return input.success
            ? {
                  kind: 'access-policy',
                  sourceId,
                  label,
                  domains: [],
                  status: 'ready',
                  reasons: [],
                  policyInput: input.data,
              }
            : manual('access-policy', sourceId, label, 'invalid_ip_rules')
    })
    const policyMap = new Map(policies.map((item) => [item.sourceId, item]))
    const proxies = source.proxyHosts.map((raw, index): NpmImportPlanItem => {
        const sourceId = index + 1
        const parsed = proxySchema.safeParse(raw)
        const label = Array.isArray(raw.domains)
            ? raw.domains.join(', ').slice(0, 250)
            : `Proxy #${sourceId}`
        if (!parsed.success) return manual('proxy-host', sourceId, label, 'invalid_host_settings')
        const host = parsed.data
        const accessListId = host.accessPolicyId ? policyIds.get(host.accessPolicyId) : undefined
        if (
            host.accessPolicyId &&
            (!accessListId || policyMap.get(accessListId)?.status !== 'ready')
        ) {
            return manual('proxy-host', sourceId, label, 'access_list_manual', host.domains)
        }
        const reasons: string[] = []
        if (host.certificateRequired) reasons.push('certificate_manual')
        if (host.forceHttps) reasons.push('force_https_manual')
        if (host.trustedCaRequired) reasons.push('trusted_ca_manual')
        if (accessListId && policyMap.get(accessListId)?.policyInput?.mode === 'ip-restricted') {
            reasons.push('ip_policy_review')
        }
        const input = createProxyHostInputSchema.safeParse({
            domains: host.domains,
            forwardScheme: host.forwardScheme,
            forwardHost: host.forwardHost,
            forwardPort: host.forwardPort,
            enabled: host.enabled && reasons.length === 0,
            certificateId: null,
            forceHttps: false,
            verifyUpstreamTls: host.verifyUpstreamTls,
            upstreamTlsServerName: host.upstreamTlsServerName,
            trustedCaId: null,
            accessPolicyId: null,
        })
        return input.success
            ? {
                  kind: 'proxy-host',
                  sourceId,
                  label,
                  domains: input.data.domains,
                  status: reasons.length ? 'partial' : 'ready',
                  reasons,
                  proxyInput: input.data,
                  ...(accessListId ? { accessListId } : {}),
              }
            : manual('proxy-host', sourceId, label, 'invalid_upstream', host.domains)
    })
    const redirects = source.redirectHosts.map((raw, index): NpmImportPlanItem => {
        const sourceId = index + 1
        const parsed = redirectSchema.safeParse(raw)
        const label = Array.isArray(raw.domains)
            ? raw.domains.join(', ').slice(0, 250)
            : `Redirect #${sourceId}`
        if (!parsed.success)
            return manual('redirect-host', sourceId, label, 'invalid_host_settings')
        const host = parsed.data
        const reasons = host.certificateRequired ? ['certificate_manual'] : []
        const input = createRedirectHostInputSchema.safeParse({
            domains: host.domains,
            destination: host.destination,
            statusCode: host.statusCode,
            preserveRequestUri: host.preserveRequestUri,
            enabled: host.enabled && reasons.length === 0,
            certificateId: null,
        })
        return input.success
            ? {
                  kind: 'redirect-host',
                  sourceId,
                  label,
                  domains: input.data.domains,
                  status: reasons.length ? 'partial' : 'ready',
                  reasons,
                  redirectInput: input.data,
              }
            : manual('redirect-host', sourceId, label, 'invalid_redirect', host.domains)
    })
    return finalizeImportPlan(
        fingerprint,
        PORTABLE_SCHEMA,
        [...policies, ...proxies, ...redirects],
        existingDomains,
    )
}

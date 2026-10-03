import type { NpmImportPlanItem, NpmImportPlan } from './Types/npm-plan.types.ts'
import { createHash } from 'node:crypto'

import { createAccessPolicyInputSchema } from '@/features/Admin/AccessPolicyManagement/validation.ts'

import {
    createProxyHostInputSchema,
    proxyHostDomainsSchema,
} from '@/features/Admin/ProxyHostManagement/validation.ts'
import { normalizeForwardHost } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'

import { createRedirectHostInputSchema } from '@/features/Admin/RedirectHostManagement/validation.ts'
import type {
    NpmImportKind,
    NpmImportPreview,
    NpmImportStatus,
} from '@/features/Admin/NpmImport/Types/npm-import.types.ts'
import type { NpmRecord, NpmSource } from './Types/npm-source.types.ts'

function integer(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function flag(value: unknown): boolean | null {
    return value === 1 ? true : value === 0 ? false : null
}

function string(value: unknown, maxLength: number): string | null {
    return typeof value === 'string' && value.length <= maxLength ? value : null
}

function domains(value: unknown): string[] | null {
    const encoded = string(value, 8_192)
    if (encoded === null) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(encoded)
    } catch {
        return null
    }
    const normalized = proxyHostDomainsSchema.safeParse(parsed)
    return normalized.success ? normalized.data : null
}

function base(
    kind: NpmImportKind,
    row: NpmRecord,
    domainNames: readonly string[] | null,
): NpmImportPlanItem {
    const sourceId = integer(row.id) ?? -1
    return {
        kind,
        sourceId,
        label: domainNames?.join(', ') ?? `${kind} #${sourceId}`,
        domains: domainNames ?? [],
        status: 'manual',
        reasons: [],
    }
}

function withReason(item: NpmImportPlanItem, reason: string): NpmImportPlanItem {
    return { ...item, status: 'manual', reasons: [...item.reasons, reason] }
}

function mapAccessList(
    row: NpmRecord,
    clients: readonly NpmRecord[],
    authCount: number,
): NpmImportPlanItem {
    const id = integer(row.id) ?? -1
    const name = string(row.name, 120)?.trim()
    const item: NpmImportPlanItem = {
        kind: 'access-policy',
        sourceId: id,
        label: name || `Access List #${id}`,
        domains: [],
        status: 'manual',
        reasons: [],
    }
    if (!name || id < 1) return withReason(item, 'invalid_access_list')
    if (authCount > 0) return withReason(item, 'basic_auth_manual')
    if (clients.length === 0) return withReason(item, 'empty_access_list')
    if (clients.some((client) => client.directive !== 'allow')) {
        return withReason(item, 'ordered_ip_rules_manual')
    }
    const addresses = clients.map((client) => client.address)
    const policy = createAccessPolicyInputSchema.safeParse({
        name,
        description: 'Imported from Nginx Proxy Manager',
        mode: 'ip-restricted',
        combination: null,
        ipRules: { defaultAction: 'deny', allow: addresses, deny: [] },
        forwardAuth: null,
    })
    if (!policy.success) return withReason(item, 'invalid_ip_rules')
    return { ...item, status: 'ready', policyInput: policy.data }
}

function hasLocations(value: unknown): boolean {
    if (value === null || value === undefined) return false
    const raw = string(value, 8_192)
    if (raw === null) return true
    try {
        const parsed: unknown = JSON.parse(raw)
        return !Array.isArray(parsed) || parsed.length > 0
    } catch {
        return true
    }
}

function mapProxy(
    row: NpmRecord,
    lists: ReadonlyMap<number, NpmImportPlanItem>,
): NpmImportPlanItem {
    const domainNames = domains(row.domain_names)
    let item = base('proxy-host', row, domainNames)
    if (!domainNames || item.sourceId < 1) return withReason(item, 'invalid_domains')
    const reasons: string[] = []
    if ((integer(row.advanced_length) ?? 0) > 0) reasons.push('advanced_config_manual')
    if (hasLocations(row.locations)) reasons.push('custom_locations_manual')
    if (flag(row.caching_enabled) !== false) reasons.push('caching_manual')
    if (flag(row.block_exploits) !== false) reasons.push('block_exploits_manual')
    if (flag(row.hsts_enabled) !== false || flag(row.hsts_subdomains) !== false) {
        reasons.push('hsts_manual')
    }
    const accessListId = integer(row.access_list_id)
    const list = accessListId && accessListId > 0 ? lists.get(accessListId) : undefined
    if (accessListId === null || accessListId < 0 || (accessListId > 0 && !list)) {
        reasons.push('access_list_missing')
    } else if (list?.status !== 'ready' && list?.reasons[0] !== 'empty_access_list') {
        if (list) reasons.push('access_list_manual')
    }
    const enabled = flag(row.enabled)
    const websocket = flag(row.allow_websocket_upgrade)
    const certificateId = integer(row.certificate_id)
    const forceSsl = flag(row.ssl_forced)
    const http2 = flag(row.http2_support)
    const trustForwardedProto = flag(row.trust_forwarded_proto)
    if (
        enabled === null ||
        websocket === null ||
        certificateId === null ||
        certificateId < 0 ||
        forceSsl === null ||
        http2 === null ||
        trustForwardedProto === null
    )
        reasons.push('invalid_host_settings')
    if (reasons.length > 0) return { ...item, reasons }

    const partialReasons: string[] = []
    if (certificateId! > 0) partialReasons.push('certificate_manual')
    if (forceSsl) partialReasons.push('force_https_manual')
    if (http2) partialReasons.push('http2_behavior_review')
    if (trustForwardedProto) partialReasons.push('forwarded_proto_review')
    if (!websocket) partialReasons.push('websocket_behavior_review')
    if (row.forward_scheme === 'https') partialReasons.push('upstream_tls_review')
    if (list?.status === 'ready') partialReasons.push('ip_policy_review')
    // A partial host is never activated automatically; the operator resolves its warnings first.
    const input = createProxyHostInputSchema.safeParse({
        domains: domainNames,
        forwardScheme: row.forward_scheme,
        forwardHost: row.forward_host,
        forwardPort: row.forward_port,
        enabled: Boolean(enabled && partialReasons.length === 0),
        certificateId: null,
        forceHttps: false,
        verifyUpstreamTls: row.forward_scheme !== 'https',
        upstreamTlsServerName: null,
        trustedCaId: null,
        accessPolicyId: null,
    })
    if (!input.success) return withReason(item, 'invalid_upstream')
    item = {
        ...item,
        status: partialReasons.length ? 'partial' : 'ready',
        reasons: partialReasons,
        proxyInput: input.data,
        ...(list?.status === 'ready' ? { accessListId: accessListId! } : {}),
    }
    return item
}

function mapRedirect(row: NpmRecord): NpmImportPlanItem {
    const domainNames = domains(row.domain_names)
    let item = base('redirect-host', row, domainNames)
    if (!domainNames || item.sourceId < 1) return withReason(item, 'invalid_domains')
    const reasons: string[] = []
    if ((integer(row.advanced_length) ?? 0) > 0) reasons.push('advanced_config_manual')
    if (flag(row.block_exploits) !== false) reasons.push('block_exploits_manual')
    if (flag(row.hsts_enabled) !== false || flag(row.hsts_subdomains) !== false) {
        reasons.push('hsts_manual')
    }
    if (row.forward_scheme !== 'http' && row.forward_scheme !== 'https') {
        reasons.push('redirect_auto_scheme_manual')
    }
    const enabled = flag(row.enabled)
    const certificateId = integer(row.certificate_id)
    const forceSsl = flag(row.ssl_forced)
    const http2 = flag(row.http2_support)
    if (
        enabled === null ||
        certificateId === null ||
        certificateId < 0 ||
        forceSsl === null ||
        http2 === null ||
        flag(row.preserve_path) === null
    )
        reasons.push('invalid_host_settings')
    if (reasons.length > 0) return { ...item, reasons }
    const partialReasons: string[] = []
    if (certificateId! > 0) partialReasons.push('certificate_manual')
    if (forceSsl) partialReasons.push('force_https_manual')
    if (http2) partialReasons.push('http2_behavior_review')
    const target = string(row.forward_domain_name, 253)
    const canonicalTarget = target ? normalizeForwardHost(target) : null
    if (!canonicalTarget) return withReason(item, 'invalid_redirect')
    const input = createRedirectHostInputSchema.safeParse({
        domains: domainNames,
        destination: `${row.forward_scheme}://${canonicalTarget}`,
        statusCode: row.forward_http_code,
        preserveRequestUri: flag(row.preserve_path),
        enabled: Boolean(enabled && partialReasons.length === 0),
        certificateId: null,
    })
    if (!input.success) return withReason(item, 'invalid_redirect')
    item = {
        ...item,
        status: partialReasons.length ? 'partial' : 'ready',
        reasons: partialReasons,
        redirectInput: input.data,
    }
    return item
}

export function buildNpmImportPlan(
    source: NpmSource,
    fingerprint: string,
    existingDomains: ReadonlyMap<string, string>,
): NpmImportPlan {
    const authCounts = new Map(
        source.authCounts.map((row) => [integer(row.access_list_id), integer(row.count) ?? 0]),
    )
    const lists = source.accessLists.map((row) => {
        const id = integer(row.id)
        return mapAccessList(
            row,
            source.accessClients.filter((client) => client.access_list_id === id),
            authCounts.get(id) ?? 0,
        )
    })
    const listMap = new Map(lists.map((list) => [list.sourceId, list]))
    const hosts = [
        ...source.proxyHosts.map((row) => mapProxy(row, listMap)),
        ...source.redirectHosts.map(mapRedirect),
    ]
    const sourceCounts = new Map<string, number>()
    for (const host of hosts)
        for (const domain of host.domains) {
            sourceCounts.set(domain, (sourceCounts.get(domain) ?? 0) + 1)
        }
    const checkedHosts: NpmImportPlanItem[] = []
    for (const host of hosts) {
        if (host.domains.some((domain) => (sourceCounts.get(domain) ?? 0) > 1)) {
            checkedHosts.push({ ...host, status: 'conflict', reasons: ['source_duplicate_domain'] })
            continue
        }
        const existing = host.domains.find((domain) => existingDomains.has(domain))
        if (existing) {
            checkedHosts.push({
                ...host,
                status: 'conflict',
                reasons: [`existing_domain:${existingDomains.get(existing)}`],
            })
            continue
        }
        checkedHosts.push(host)
    }
    const usedLists = new Set(
        checkedHosts
            .filter((host) => host.status === 'ready' || host.status === 'partial')
            .map((host) => host.accessListId),
    )
    const checkedLists = lists.map((list): NpmImportPlanItem => {
        if (list.status === 'ready' && !usedLists.has(list.sourceId)) {
            return withReason(list, 'unreferenced_access_list')
        }
        return list
    })
    const certificates: NpmImportPlanItem[] = source.certificates.map((row) => ({
        kind: 'certificate',
        sourceId: integer(row.id) ?? -1,
        label: string(row.nice_name, 120) || `Certificate #${row.id}`,
        domains: domains(row.domain_names) ?? [],
        status: 'manual',
        reasons: ['certificate_material_unavailable'],
    }))
    const placeholders: NpmImportPlanItem[] = [
        ...source.deadHosts.map((row): NpmImportPlanItem => ({
            kind: 'dead-host',
            sourceId: integer(row.id) ?? -1,
            label: domains(row.domain_names)?.join(', ') || `404 host #${row.id}`,
            domains: domains(row.domain_names) ?? [],
            status: 'manual',
            reasons: ['dead_hosts_manual'],
        })),
        ...source.streams.map((row): NpmImportPlanItem => ({
            kind: 'stream',
            sourceId: integer(row.id) ?? -1,
            label: `Stream #${row.id} (port ${integer(row.incoming_port) ?? '?'})`,
            domains: [],
            status: 'manual',
            reasons: ['streams_manual'],
        })),
    ]
    return {
        fingerprint,
        sourceSchema: source.schema,
        items: [...checkedLists, ...checkedHosts, ...certificates, ...placeholders],
    }
}

export function publicNpmPreview(plan: NpmImportPlan): NpmImportPreview {
    const items = plan.items.map(
        ({ kind, sourceId, label, domains: domainNames, status, reasons }) => ({
            kind,
            sourceId,
            label,
            domains: domainNames,
            status,
            reasons,
        }),
    )
    const counts: Record<NpmImportStatus, number> = { ready: 0, partial: 0, manual: 0, conflict: 0 }
    for (const item of items) counts[item.status] += 1
    const planFingerprint = createHash('sha256').update(JSON.stringify(items)).digest('hex')
    return {
        fingerprint: plan.fingerprint,
        planFingerprint,
        sourceSchema: plan.sourceSchema,
        items,
        counts,
    }
}

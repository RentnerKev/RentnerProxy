import type { SourceEntry, ZoraxySource } from './Types/zoraxy.types.ts'
// oxlint-disable-next-line import/no-unassigned-import -- ZIP parsing must stay server-side.
import '@tanstack/react-start/server-only'

import { createProxyHostInputSchema } from '@/features/Admin/ProxyHostManagement/validation.ts'
import { createRedirectHostInputSchema } from '@/features/Admin/RedirectHostManagement/validation.ts'
import { normalizeForwardHost } from '@/lib/Admin/ProxyHostManagement/proxyHostValidation.ts'
import type {
    NpmImportPlan,
    NpmImportPlanItem,
} from '@/server/Admin/NpmImport/Types/npm-plan.types.ts'
import { finalizeImportPlan } from './import-plan.ts'

import yauzl, { type Entry, type ZipFile } from 'yauzl'

const MAX_ENTRIES = 2_000
const MAX_SELECTED = 500
const MAX_ENTRY_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
export const ZORAXY_SCHEMA = 'zoraxy-v3-config-zip'

export class ZoraxySourceError extends Error {
    constructor(readonly code: 'invalid_source' | 'source_limit') {
        super(code)
    }
}

function validName(name: string): boolean {
    return (
        name.length > 0 &&
        name.length <= 512 &&
        !name.startsWith('/') &&
        !name.includes('\\') &&
        !name.includes('\0') &&
        !/^[A-Za-z]:/u.test(name) &&
        !name.split('/').some((part) => part === '..' || part === '')
    )
}

function readEntry(zip: ZipFile, entry: Entry): Promise<unknown> {
    return new Promise((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return reject(new ZoraxySourceError('invalid_source'))
            const chunks: Buffer[] = []
            let size = 0
            stream.on('data', (chunk: Buffer) => {
                size += chunk.byteLength
                if (size > MAX_ENTRY_BYTES) stream.destroy(new ZoraxySourceError('source_limit'))
                else chunks.push(chunk)
            })
            stream.once('error', reject)
            stream.once('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
                } catch {
                    reject(new ZoraxySourceError('invalid_source'))
                }
            })
        })
    })
}

export async function readZoraxySource(path: string): Promise<ZoraxySource> {
    return new Promise((resolve, reject) => {
        yauzl.open(
            path,
            {
                lazyEntries: true,
                autoClose: true,
                decodeStrings: true,
                validateEntrySizes: true,
                strictFileNames: true,
            },
            (openError, zip) => {
                if (openError || !zip) return reject(new ZoraxySourceError('invalid_source'))
                if (zip.entryCount > MAX_ENTRIES) {
                    zip.close()
                    return reject(new ZoraxySourceError('source_limit'))
                }
                const proxies: SourceEntry[] = []
                const redirects: SourceEntry[] = []
                const omitted = { streams: 0, accessRules: 0, certificates: 0, pathRules: 0 }
                const names = new Set<string>()
                let totalBytes = 0
                let settled = false
                const fail = (error: unknown) => {
                    if (settled) return
                    settled = true
                    zip.close()
                    reject(
                        error instanceof ZoraxySourceError
                            ? error
                            : new ZoraxySourceError('invalid_source'),
                    )
                }
                zip.on('error', fail)
                zip.on('end', () => {
                    if (settled) return
                    if (
                        proxies.length +
                            redirects.length +
                            Object.values(omitted).reduce((sum, count) => sum + count, 0) ===
                        0
                    )
                        return fail(new ZoraxySourceError('invalid_source'))
                    settled = true
                    resolve({ proxies, redirects, omitted })
                })
                zip.on('entry', (entry: Entry) => {
                    const name = entry.fileName.replace(/^\.\//u, '')
                    if (
                        !validName(name) ||
                        entry.isEncrypted() ||
                        ![0, 8].includes(entry.compressionMethod)
                    ) {
                        return fail(new ZoraxySourceError('invalid_source'))
                    }
                    const mode = entry.externalFileAttributes >>> 16
                    if ((mode & 0o170000) === 0o120000)
                        return fail(new ZoraxySourceError('invalid_source'))
                    if (names.has(name.toLowerCase()))
                        return fail(new ZoraxySourceError('invalid_source'))
                    names.add(name.toLowerCase())
                    totalBytes += entry.uncompressedSize
                    if (totalBytes > MAX_TOTAL_BYTES)
                        return fail(new ZoraxySourceError('source_limit'))
                    const isProxy = /^conf\/proxy\/[^/]+\.config$/u.test(name)
                    const isRedirect = /^conf\/redirect\/[^/]+\.json$/u.test(name)
                    if (!isProxy && !isRedirect) {
                        if (/^conf\/streamproxy\/[^/]+\.config$/u.test(name)) omitted.streams += 1
                        else if (/^conf\/access\/[^/]+$/u.test(name)) omitted.accessRules += 1
                        else if (/^conf\/certs\/[^/]+$/u.test(name)) omitted.certificates += 1
                        else if (/^conf\/(?:rules\/pathrules|proxy)\/.+\.config$/u.test(name))
                            omitted.pathRules += 1
                        zip.readEntry()
                        return
                    }
                    if (
                        entry.uncompressedSize > MAX_ENTRY_BYTES ||
                        proxies.length + redirects.length >= MAX_SELECTED
                    ) {
                        return fail(new ZoraxySourceError('source_limit'))
                    }
                    void readEntry(zip, entry)
                        .then((value) => {
                            ;(isProxy ? proxies : redirects).push({ name, value })
                            zip.readEntry()
                        })
                        .catch(fail)
                })
                zip.readEntry()
            },
        )
    })
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function empty(value: unknown, depth = 0): boolean {
    if (depth > 32) return false
    if (value === null || value === undefined || value === false || value === 0 || value === '')
        return true
    if (Array.isArray(value)) return value.every((entry) => empty(entry, depth + 1))
    const object = record(value)
    return object ? Object.values(object).every((entry) => empty(entry, depth + 1)) : false
}

function unsupported(row: Record<string, unknown>, supported: ReadonlySet<string>): boolean {
    return Object.entries(row).some(([key, value]) => !supported.has(key) && !empty(value))
}

const proxyFields = new Set([
    'ProxyType',
    'RootOrMatchingDomain',
    'MatchingDomainAlias',
    'ActiveOrigins',
    'InactiveOrigins',
    'Disabled',
    'AccessFilterUUID',
    'AuthenticationProvider',
    'HeaderRewriteRules',
])
const originFields = new Set([
    'OriginIpOrDomain',
    'RequireTLS',
    'SkipCertValidations',
    'SkipWebSocketOriginCheck',
    'Weight',
])
const redirectFields = new Set([
    'Enabled',
    'RedirectURL',
    'TargetURL',
    'ForwardChildpath',
    'StatusCode',
    'RequireExactMatch',
    'DeviceType',
])

function manual(
    kind: NpmImportPlanItem['kind'],
    id: number,
    label: string,
    reason: string,
): NpmImportPlanItem {
    return { kind, sourceId: id, label, domains: [], status: 'manual', reasons: [reason] }
}

function upstream(value: unknown, requireTls: boolean): { host: string; port: number } | null {
    if (
        typeof value !== 'string' ||
        value.length > 300 ||
        value.includes('/') ||
        value.endsWith(':')
    )
        return null
    try {
        const url = new URL(`${requireTls ? 'https' : 'http'}://${value}`)
        if (url.username || url.password || url.search || url.hash) return null
        const rawHost = url.hostname.replace(/^\[|\]$/gu, '')
        const host = normalizeForwardHost(rawHost)
        const port = Number(url.port || (requireTls ? 443 : 80))
        return host && Number.isInteger(port) && port >= 1 && port <= 65535 ? { host, port } : null
    } catch {
        return null
    }
}

function proxyItem(source: SourceEntry, id: number): NpmImportPlanItem {
    const row = record(source.value)
    const label =
        typeof row?.RootOrMatchingDomain === 'string'
            ? row.RootOrMatchingDomain.slice(0, 253)
            : source.name
    if (!row || row.ProxyType !== 1 || typeof row.RootOrMatchingDomain !== 'string') {
        return manual('proxy-host', id, label, 'zoraxy_unsupported_rule')
    }
    const alias = row.MatchingDomainAlias ?? []
    const origins = row.ActiveOrigins
    if (
        !Array.isArray(alias) ||
        !Array.isArray(origins) ||
        origins.length !== 1 ||
        !empty(row.InactiveOrigins) ||
        unsupported(row, proxyFields) ||
        (row.AccessFilterUUID !== undefined &&
            row.AccessFilterUUID !== '' &&
            row.AccessFilterUUID !== 'default') ||
        !empty(row.AuthenticationProvider) ||
        !empty(row.HeaderRewriteRules) ||
        (row.Disabled !== undefined && typeof row.Disabled !== 'boolean')
    )
        return manual('proxy-host', id, label, 'zoraxy_unsupported_rule')
    const origin = record(origins[0])
    if (
        !origin ||
        unsupported(origin, originFields) ||
        (origin.Weight !== undefined && origin.Weight !== 1)
    ) {
        return manual('proxy-host', id, label, 'zoraxy_unsupported_rule')
    }
    if (
        typeof origin.RequireTLS !== 'boolean' ||
        typeof origin.SkipCertValidations !== 'boolean' ||
        typeof origin.SkipWebSocketOriginCheck !== 'boolean'
    ) {
        return manual('proxy-host', id, label, 'invalid_upstream')
    }
    const target = upstream(origin.OriginIpOrDomain, origin.RequireTLS)
    if (!target) return manual('proxy-host', id, label, 'invalid_upstream')
    const reasons = ['zoraxy_tls_review']
    if (origin.RequireTLS) reasons.push('upstream_tls_review')
    if (origin.SkipCertValidations) reasons.push('upstream_tls_verification_review')
    if (origin.SkipWebSocketOriginCheck) reasons.push('websocket_behavior_review')
    const input = createProxyHostInputSchema.safeParse({
        domains: [row.RootOrMatchingDomain, ...alias],
        forwardScheme: origin.RequireTLS ? 'https' : 'http',
        forwardHost: target.host,
        forwardPort: target.port,
        enabled: false,
        certificateId: null,
        forceHttps: false,
        verifyUpstreamTls: !origin.SkipCertValidations,
        upstreamTlsServerName: null,
        trustedCaId: null,
        accessPolicyId: null,
    })
    return input.success
        ? {
              kind: 'proxy-host',
              sourceId: id,
              label,
              domains: input.data.domains,
              status: 'partial',
              reasons,
              proxyInput: input.data,
          }
        : manual('proxy-host', id, label, 'invalid_domains')
}

function redirectItem(source: SourceEntry, id: number): NpmImportPlanItem {
    const row = record(source.value)
    const label = typeof row?.RedirectURL === 'string' ? row.RedirectURL.slice(0, 253) : source.name
    if (
        !row ||
        unsupported(row, redirectFields) ||
        typeof row.RedirectURL !== 'string' ||
        typeof row.TargetURL !== 'string' ||
        typeof row.ForwardChildpath !== 'boolean' ||
        (row.Enabled !== undefined && typeof row.Enabled !== 'boolean') ||
        row.RequireExactMatch !== false ||
        (row.DeviceType !== '' && row.DeviceType !== 'all' && row.DeviceType !== undefined)
    )
        return manual('redirect-host', id, label, 'zoraxy_unsupported_redirect')
    const domain = row.RedirectURL
    if (
        domain.includes('/') ||
        domain.includes(':') ||
        domain.includes('?') ||
        domain.includes('#')
    ) {
        return manual('redirect-host', id, label, 'zoraxy_unsupported_redirect')
    }
    const destination = /^https?:\/\//iu.test(row.TargetURL)
        ? row.TargetURL
        : `http://${row.TargetURL}`
    const input = createRedirectHostInputSchema.safeParse({
        domains: [domain],
        destination,
        statusCode: row.StatusCode,
        preserveRequestUri: row.ForwardChildpath,
        enabled: false,
        certificateId: null,
    })
    return input.success
        ? {
              kind: 'redirect-host',
              sourceId: id,
              label,
              domains: input.data.domains,
              status: 'partial',
              reasons: ['zoraxy_tls_review'],
              redirectInput: input.data,
          }
        : manual('redirect-host', id, label, 'invalid_redirect')
}

export function buildZoraxyPlan(
    source: ZoraxySource,
    fingerprint: string,
    existingDomains: ReadonlyMap<string, string>,
): NpmImportPlan {
    const items = [
        ...source.proxies.map((entry, index) => proxyItem(entry, index + 1)),
        ...source.redirects.map((entry, index) => redirectItem(entry, index + 1)),
        ...(source.omitted.streams > 0
            ? [
                  manual(
                      'stream',
                      1,
                      `conf/streamproxy (${source.omitted.streams})`,
                      'zoraxy_streams_manual',
                  ),
              ]
            : []),
        ...(source.omitted.accessRules > 0
            ? [
                  manual(
                      'access-policy',
                      1,
                      `conf/access (${source.omitted.accessRules})`,
                      'zoraxy_access_manual',
                  ),
              ]
            : []),
        ...(source.omitted.certificates > 0
            ? [
                  manual(
                      'certificate',
                      1,
                      `conf/certs (${source.omitted.certificates})`,
                      'zoraxy_certificates_manual',
                  ),
              ]
            : []),
        ...(source.omitted.pathRules > 0
            ? [
                  manual(
                      'proxy-host',
                      MAX_SELECTED + 1,
                      `conf/rules (${source.omitted.pathRules})`,
                      'zoraxy_path_rules_manual',
                  ),
              ]
            : []),
    ]
    return finalizeImportPlan(fingerprint, ZORAXY_SCHEMA, items, existingDomains)
}

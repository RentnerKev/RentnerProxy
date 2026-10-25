import { createPrivateKey } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'

function isCanonicalCertificateDomain(value: unknown): value is string {
    if (typeof value !== 'string' || value.length > 253) return false
    const wildcard = value.startsWith('*.')
    const domain = wildcard ? value.slice(2) : value
    return (
        (!wildcard || (domain.includes('.') && domain.length <= 251)) &&
        isIP(domain) === 0 &&
        domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
    )
}

const id = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
const timestamp = z.string().max(40).datetime({ offset: true })
const phase = z.enum([
    'awaiting_input',
    'checking_dns',
    'validating',
    'finalizing',
    'complete',
    'cancelled',
    'expired',
    'failed',
])
const bytes = z
    .array(z.number().int().min(0).max(255))
    .min(1)
    .max(64 * 1024)
const manualOrder = z.strictObject({
    version: z.literal(1),
    operationId: id,
    challengeSetId: id,
    accountIdentity: z.string().regex(/^[a-f0-9]{64}$/u),
    orderUrl: z.string().max(2048).url(),
    expiresAt: timestamp,
    records: z
        .array(
            z.strictObject({
                identifier: z.string().max(253),
                owner: z.string().max(253),
                value: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
                expiresAt: timestamp,
            }),
        )
        .max(100),
    phase,
    privateKeyPem: z
        .string()
        .min(1)
        .max(64 * 1024)
        .nullable(),
    csrDer: bytes.nullable(),
    lastCheckedAt: timestamp.nullable(),
    lastErrorCode: z
        .enum([
            'manual_dns_not_propagated',
            'manual_dns_lookup_failed',
            'manual_dns_expired',
            'manual_dns_cancelled',
            'manual_dns_order_invalid',
            'acme_failed',
            'invalid_certificate',
            'key_mismatch',
            'certificate_expired',
            'domain_mismatch',
            'certificate_not_found',
            'certificate_in_use',
            'operation_in_progress',
            'acme_terms_required',
            'acme_domain_invalid',
            'acme_dns_required',
            'dns_provider_invalid',
            'dns_provider_unavailable',
            'dns_provider_unauthorized',
            'dns_cleanup_failed',
            'dns_credentials_unavailable',
            'certificate_store_unavailable',
            'runtime_apply_failed',
        ])
        .nullable(),
})

/** Validate the additive private state without publishing its account URL or key. */
export function validateManualDnsBackupState(
    certificate: Record<string, unknown>,
    certificateId: unknown,
): void {
    if (
        !certificate.acme ||
        typeof certificate.acme !== 'object' ||
        Array.isArray(certificate.acme)
    )
        return
    const acme = certificate.acme as Record<string, unknown>
    const stored = acme.manualOrder
    if (acme.dnsMode !== undefined && acme.dnsMode !== 'provider' && acme.dnsMode !== 'manual')
        throw new Error('invalid manual DNS certificate state')
    if (acme.dnsMode !== 'manual') {
        if (stored != null) throw new Error('invalid manual DNS certificate state')
        return
    }
    if (
        acme.challengeType !== 'dns-01' ||
        acme.dnsProvider != null ||
        (acme.pendingDnsRecords !== undefined &&
            (!Array.isArray(acme.pendingDnsRecords) || acme.pendingDnsRecords.length !== 0))
    )
        throw new Error('invalid manual DNS certificate state')
    if (stored == null) return
    const parsed = manualOrder.safeParse(stored)
    const metadata =
        certificate.metadata && typeof certificate.metadata === 'object'
            ? (certificate.metadata as Record<string, unknown>)
            : certificate
    const operation = metadata.currentOperation as { id?: unknown } | null | undefined
    const domains = metadata.domains
    if (
        !parsed.success ||
        !id.safeParse(certificateId).success ||
        !operation ||
        operation.id !== parsed.data.operationId ||
        !Array.isArray(domains) ||
        domains.length < 1 ||
        domains.length > 100 ||
        domains.some((domain) => !isCanonicalCertificateDomain(domain))
    )
        throw new Error('invalid manual DNS certificate state')
    const order = parsed.data
    const url = new URL(order.orderUrl)
    const terminal = ['complete', 'cancelled', 'expired', 'failed'].includes(order.phase)
    const identifiers = new Set<string>()
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        (order.phase === 'awaiting_input' && order.records.length === 0) ||
        (order.privateKeyPem === null) !== (order.csrDer === null) ||
        (terminal && order.privateKeyPem !== null)
    )
        throw new Error('invalid manual DNS certificate state')
    for (const record of order.records) {
        if (
            !domains.includes(record.identifier) ||
            record.owner !== `_acme-challenge.${record.identifier.replace(/^\*\./u, '')}` ||
            identifiers.has(record.identifier) ||
            Date.parse(record.expiresAt) < Date.parse(order.expiresAt)
        )
            throw new Error('invalid manual DNS certificate state')
        identifiers.add(record.identifier)
    }
    if (order.privateKeyPem !== null) {
        try {
            createPrivateKey(order.privateKeyPem)
            if (order.csrDer?.[0] !== 0x30) throw new Error('invalid CSR encoding')
        } catch {
            throw new Error('invalid manual DNS certificate key material')
        }
    }
}

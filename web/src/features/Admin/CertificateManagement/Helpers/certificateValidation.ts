import { CERTIFICATE_EXPIRING_WINDOW_MS } from '../../../../config/certificates.config'
import type {
    CertificateStatus,
    CertificateStoredStatus,
} from '../../../../config/certificates.config'
import { normalizeProxyDomain } from '../../ProxyHostManagement/Helpers/proxyHostValidation'

export function normalizeCertificateDomain(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed.startsWith('*.')) return normalizeProxyDomain(trimmed)
    const domain = normalizeProxyDomain(trimmed.slice(2))
    return domain && domain.includes('.') && domain.length <= 251 ? `*.${domain}` : null
}

export function certificateCoversDomains(
    certificateDomains: ReadonlyArray<string>,
    hostDomains: ReadonlyArray<string>,
): boolean {
    return (
        hostDomains.length > 0 &&
        hostDomains.every((host) => {
            const canonical = normalizeProxyDomain(host)
            if (!canonical) return false
            return certificateDomains.some((domain) => {
                if (!domain.startsWith('*.')) return domain === canonical
                const suffix = domain.slice(1)
                if (!canonical.endsWith(suffix)) return false
                const label = canonical.slice(0, -suffix.length)
                return label.length > 0 && !label.includes('.')
            })
        })
    )
}

export function isPublicAcmeDomain(domain: string): boolean {
    const canonical = normalizeProxyDomain(domain)
    if (!canonical || !canonical.includes('.') || domain.startsWith('*.')) return false
    const suffix = canonical.split('.').at(-1)
    return ![
        'test',
        'invalid',
        'localhost',
        'example',
        'local',
        'internal',
        'onion',
        'home',
        'lan',
    ].includes(suffix ?? '')
}

export function getCertificateStatus(
    storedStatus: CertificateStoredStatus,
    issuedAt: Date | null,
    expiresAt: Date | null,
    now = Date.now(),
): CertificateStatus {
    if (storedStatus !== 'valid' || !issuedAt || !expiresAt) return storedStatus
    if (expiresAt.getTime() <= now) return 'expired'
    if (issuedAt.getTime() > now) return 'pending'
    const window = Math.min(
        CERTIFICATE_EXPIRING_WINDOW_MS,
        (expiresAt.getTime() - issuedAt.getTime()) / 3,
    )
    return expiresAt.getTime() - now <= window ? 'expiring' : 'valid'
}

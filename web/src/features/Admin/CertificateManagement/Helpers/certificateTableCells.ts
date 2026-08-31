import type { CertificateStatus } from '../../../../config/certificates.config'

export function formatCertificateDate(value: Date | null, formatter: Intl.DateTimeFormat): string {
    if (!value || Number.isNaN(value.getTime())) return '—'
    return formatter.format(value)
}

export function certificateStatusClass(status: CertificateStatus): string {
    if (status === 'valid') return 'bg-success-bg text-success-text'
    if (status === 'expiring') return 'bg-brand-500/15 text-warning-text'
    if (status === 'expired' || status === 'failed') return 'bg-danger-bg text-danger-text'
    return 'bg-info-bg text-info-text'
}

export function certificateSourceClass(source: 'manual' | 'acme'): string {
    return source === 'acme' ? 'bg-info-bg text-info-text' : 'bg-neutral text-muted'
}

import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { Tooltip } from '../../../../shared/Tooltip'
import useTranslationStore, { useDateFormatter } from '../../../../language/useTranslationStore'
import type { CertificateSource, CertificateStatus } from '../../../../config/certificates.config'
import {
    certificateSourceClass,
    certificateStatusClass,
    formatCertificateDate,
} from '../Helpers/certificateTableCells'

const badge = 'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold'

export function CertificateDomainsCell({ domains }: { readonly domains: ReadonlyArray<string> }) {
    const { t } = useTranslationStore()
    const visible = domains.slice(0, 2)
    const extra = domains.slice(2)
    if (visible.length === 0) return <span className="text-muted">—</span>
    return (
        <div className={uiClassNames.chip.row}>
            {visible.map((domain) => (
                <span className={uiClassNames.chip.item + ' max-w-56 wrap-anywhere'} key={domain}>
                    {domain}
                </span>
            ))}
            {extra.length > 0 ? (
                <Tooltip content={extra.join(', ')}>
                    <button
                        type="button"
                        className="inline-flex h-12 cursor-help items-center justify-center rounded-xl border-0 bg-neutral px-3 py-0 font-mono text-sm font-bold text-muted outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500"
                        aria-label={t('admin.certificates.cells.moreDomains', {
                            count: extra.length,
                        })}
                    >
                        +{extra.length}
                    </button>
                </Tooltip>
            ) : null}
        </div>
    )
}

export function CertificateSourceCell({ source }: { readonly source: CertificateSource }) {
    const { t } = useTranslationStore()
    return (
        <span className={`${badge} ${certificateSourceClass(source)}`}>
            {t(`admin.certificates.source.${source}`)}
        </span>
    )
}

export function CertificateStatusCell({
    candidate,
    status,
}: {
    readonly candidate: boolean
    readonly status: CertificateStatus
}) {
    const { t } = useTranslationStore()
    return (
        <div className="flex flex-wrap gap-2">
            <span className={`${badge} ${certificateStatusClass(status)}`}>
                {t(`admin.certificates.status.${status}`)}
            </span>
            {candidate ? (
                <span className={`${badge} bg-info-bg text-info-text`}>
                    {t('admin.certificates.status.candidate')}
                </span>
            ) : null}
        </div>
    )
}

export function CertificateDateCell({ value }: { readonly value: Date | null }) {
    const formatter = useDateFormatter()
    return (
        <span className="whitespace-nowrap text-muted">
            {formatCertificateDate(value, formatter)}
        </span>
    )
}

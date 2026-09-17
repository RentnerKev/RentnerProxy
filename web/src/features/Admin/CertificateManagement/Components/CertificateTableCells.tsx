import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { ManagedDomainLink, ManagedDomainOverflow } from '../../../../shared/Domain'
import useTranslationStore, { useDateFormatter } from '../../../../language/useTranslationStore'
import type { CertificateSource, CertificateStatus } from '../../../../config/certificates.config'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'
import {
    certificateSourceClass,
    certificateStatusClass,
    formatCertificateDate,
} from '../Helpers/certificateTableCells'
import {
    certificateOperationStageClass,
    getCertificateOperationDisplay,
} from '../Helpers/certificateOperations'

const badge = 'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold'

export function CertificateDomainsCell({ domains }: { readonly domains: ReadonlyArray<string> }) {
    const { t } = useTranslationStore()
    const visible = domains.slice(0, 2)
    const extra = domains.slice(2)
    if (visible.length === 0) return <span className="text-muted">—</span>
    return (
        <div className={uiClassNames.chip.row}>
            {visible.map((domain) => (
                <ManagedDomainLink
                    className={uiClassNames.chip.item + ' max-w-56 wrap-anywhere'}
                    domain={domain}
                    key={domain}
                />
            ))}
            {extra.length > 0 ? (
                <ManagedDomainOverflow
                    ariaLabel={t('common.moreDomains', { count: extra.length })}
                    domains={extra}
                />
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

export function CertificateOperationCell({
    certificate,
}: {
    readonly certificate: CertificateSummary
}) {
    const { t } = useTranslationStore()
    const operation = getCertificateOperationDisplay(certificate)
    if (!operation.stage) {
        return <span className="text-xs text-muted">{t('admin.certificates.operation.idle')}</span>
    }
    return (
        <div className="grid justify-items-start gap-1">
            <div className="flex flex-wrap gap-2">
                <span className={`${badge} ${certificateOperationStageClass(operation.stage)}`}>
                    {t(`admin.certificates.operationStages.${operation.stage}`)}
                </span>
                {operation.kind ? (
                    <span className={`${badge} bg-neutral text-muted`}>
                        {t(`admin.certificates.operationKinds.${operation.kind}`)}
                    </span>
                ) : null}
            </div>
            {operation.id ? (
                <span className="max-w-52 break-all font-mono text-[0.68rem] text-muted">
                    {t('admin.certificates.operation.operationId')}: {operation.id}
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

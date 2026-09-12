import useTranslationStore from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { CertificateDetailsModalProps } from '../Types/certificate-management.types'
import {
    certificateSourceClass,
    certificateStatusClass,
    formatCertificateDate,
} from '../Helpers/certificateTableCells'
import { useDateFormatter, useDateTimeFormatter } from '../../../../language/useTranslationStore'

const badge = 'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold'

export default function CertificateDetailsModal({
    certificate,
    onOpenChange,
    open,
}: CertificateDetailsModalProps) {
    const { t } = useTranslationStore()
    const formatter = useDateFormatter()
    const retryFormatter = useDateTimeFormatter()
    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            title={t('admin.certificates.details.title', { name: certificate.name })}
            description={t('admin.certificates.details.description')}
        >
            <div className="grid gap-5">
                <section
                    className={uiClassNames.management.card}
                    aria-labelledby="certificate-details-metadata"
                >
                    <h2
                        id="certificate-details-metadata"
                        className="text-base font-extrabold text-ink-soft"
                    >
                        {t('admin.certificates.details.metadata')}
                    </h2>
                    <dl className="mt-4 grid gap-4 shell:grid-cols-2">
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.columns.name')}
                            </dt>
                            <dd className="mt-1 break-words text-muted">{certificate.name}</dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.columns.source')}
                            </dt>
                            <dd className="mt-1">
                                <span
                                    className={`${badge} ${certificateSourceClass(certificate.source)}`}
                                >
                                    {t(`admin.certificates.source.${certificate.source}`)}
                                </span>
                            </dd>
                        </div>
                        {certificate.candidate ? (
                            <div className="shell:col-span-full rounded-xl border border-info-text/20 bg-info-bg p-4">
                                <dt className={uiClassNames.form.label}>
                                    {t('admin.certificates.details.candidate')}
                                </dt>
                                <dd className="mt-2 grid gap-3 shell:grid-cols-2">
                                    <span className="text-sm text-muted">
                                        {t('admin.certificates.details.candidateIssuedAt')}:{' '}
                                        {formatCertificateDate(
                                            certificate.candidate.issuedAt,
                                            formatter,
                                        )}
                                    </span>
                                    <span className="text-sm text-muted">
                                        {t('admin.certificates.details.candidateExpiresAt')}:{' '}
                                        {formatCertificateDate(
                                            certificate.candidate.expiresAt,
                                            formatter,
                                        )}
                                    </span>
                                    {certificate.candidate.nextAttemptAt ? (
                                        <span className="text-sm text-muted shell:col-span-full">
                                            {t('admin.certificates.details.candidateNextAttemptAt')}
                                            :{' '}
                                            {formatCertificateDate(
                                                certificate.candidate.nextAttemptAt,
                                                retryFormatter,
                                            )}{' '}
                                            UTC
                                        </span>
                                    ) : null}
                                    <span className="text-sm text-muted shell:col-span-full">
                                        {t('admin.certificates.details.candidateFingerprint')}:
                                        <span className="mt-1 block break-all font-mono text-xs">
                                            {certificate.candidate.fingerprint}
                                        </span>
                                    </span>
                                </dd>
                            </div>
                        ) : null}
                        <div className="shell:col-span-full">
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.columns.domains')}
                            </dt>
                            <dd className="mt-1 flex flex-wrap gap-2">
                                {certificate.domains.map((domain) => (
                                    <span className={uiClassNames.chip.item} key={domain}>
                                        {domain}
                                    </span>
                                ))}
                            </dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.columns.status')}
                            </dt>
                            <dd className="mt-1">
                                <span
                                    className={`${badge} ${certificateStatusClass(certificate.status)}`}
                                >
                                    {t(`admin.certificates.status.${certificate.status}`)}
                                </span>
                                {certificate.candidate ? (
                                    <span className={`${badge} ml-2 bg-info-bg text-info-text`}>
                                        {t('admin.certificates.status.candidate')}
                                    </span>
                                ) : null}
                            </dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.columns.expires')}
                            </dt>
                            <dd className="mt-1 text-muted">
                                {formatCertificateDate(certificate.expiresAt, formatter)}
                            </dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.details.issuer')}
                            </dt>
                            <dd className="mt-1 break-words text-muted">
                                {certificate.issuer ?? '—'}
                            </dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.details.issuedAt')}
                            </dt>
                            <dd className="mt-1 text-muted">
                                {formatCertificateDate(certificate.issuedAt, formatter)}
                            </dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.details.fingerprint')}
                            </dt>
                            <dd className="mt-1 break-all font-mono text-xs text-muted">
                                {certificate.fingerprint ?? '—'}
                            </dd>
                        </div>
                        <div>
                            <dt className={uiClassNames.form.label}>
                                {t('admin.certificates.details.assignedHosts')}
                            </dt>
                            <dd className="mt-1 text-muted">{certificate.assignedHostCount}</dd>
                        </div>
                    </dl>
                </section>
                {certificate.lastErrorCode ? (
                    <p className="m-0 rounded-xl border border-red-700/25 bg-danger-bg p-3 text-sm leading-relaxed text-danger-text">
                        {t(`admin.certificates.errors.${certificate.lastErrorCode}`)}
                    </p>
                ) : null}
                {certificate.candidate?.lastErrorCode ? (
                    <p className="m-0 rounded-xl border border-red-700/25 bg-danger-bg p-3 text-sm leading-relaxed text-danger-text">
                        {t(`admin.certificates.errors.${certificate.candidate.lastErrorCode}`)}
                    </p>
                ) : null}
                {certificate.dnsCleanupPending ? (
                    <p className="m-0 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700">
                        {t('admin.certificates.details.dnsCleanupPending')}
                    </p>
                ) : null}
            </div>
        </Modal>
    )
}

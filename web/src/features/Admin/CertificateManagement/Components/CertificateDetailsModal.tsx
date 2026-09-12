import type { ReactNode } from 'react'

import useTranslationStore, {
    useDateFormatter,
    useDateTimeFormatter,
} from '../../../../language/useTranslationStore'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { CertificateSummary } from '../../../../shared/Types/certificates.types'
import type { CertificateDetailsModalProps } from '../Types/certificate-management.types'
import {
    certificateOperationStageClass,
    getCertificateOperationDisplay,
    getCertificateRetryAt,
    getCertificateRetryError,
    getCertificateSchedulingDates,
} from '../Helpers/certificateOperations'
import {
    certificateSourceClass,
    certificateStatusClass,
    formatCertificateDate,
} from '../Helpers/certificateTableCells'

const badge = 'inline-flex rounded-full px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold'

function MetadataField({
    className,
    label,
    value,
}: {
    readonly className?: string
    readonly label: string
    readonly value: ReactNode
}) {
    return (
        <div className={className}>
            <dt className={uiClassNames.form.label}>{label}</dt>
            <dd className="mt-1 break-words text-muted">{value}</dd>
        </div>
    )
}

function formatDateTime(value: Date | null, formatter: Intl.DateTimeFormat): string {
    const formatted = formatCertificateDate(value, formatter)
    return formatted === '—' ? formatted : `${formatted} UTC`
}

function certificateChallengeLabel(
    challengeType: CertificateSummary['challengeType'],
    translate: (key: string) => string,
): string {
    if (!challengeType) return '—'
    return translate(
        challengeType === 'dns-01'
            ? 'admin.certificates.challenge.dns01'
            : 'admin.certificates.challenge.http01',
    )
}

export default function CertificateDetailsModal({
    certificate,
    onOpenChange,
    open,
}: CertificateDetailsModalProps) {
    const { t } = useTranslationStore()
    const formatter = useDateFormatter()
    const dateTimeFormatter = useDateTimeFormatter()
    const scheduling = getCertificateSchedulingDates(certificate)
    const operation = getCertificateOperationDisplay(certificate)
    const retryAt = getCertificateRetryAt(certificate)
    const retryError = getCertificateRetryError(certificate)
    const retryScheduled = Boolean(retryAt) || operation.stage === 'retry_scheduled'
    const retryStatus = retryScheduled
        ? t('admin.certificates.details.retryScheduled')
        : retryError
          ? t('admin.certificates.details.retryFailed')
          : t('admin.certificates.details.retryNone')
    const operationStage = operation.stage
        ? t(`admin.certificates.operationStages.${operation.stage}`)
        : t('admin.certificates.operation.idle')

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            size="lg"
            title={t('admin.certificates.details.title', { name: certificate.name })}
            description={t('admin.certificates.details.description')}
        >
            <div className="grid gap-5">
                {certificate.environment === 'staging' ? (
                    <p
                        role="note"
                        className="m-0 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm font-extrabold leading-relaxed text-amber-800"
                    >
                        {t('admin.certificates.stagingWarning')}
                    </p>
                ) : null}
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
                        <MetadataField
                            label={t('admin.certificates.columns.name')}
                            value={certificate.name}
                        />
                        <MetadataField
                            label={t('admin.certificates.columns.source')}
                            value={
                                <span
                                    className={`${badge} ${certificateSourceClass(certificate.source)}`}
                                >
                                    {t(`admin.certificates.source.${certificate.source}`)}
                                </span>
                            }
                        />
                        <MetadataField
                            label={t('admin.certificates.details.autoRenew')}
                            value={
                                certificate.source === 'acme'
                                    ? t('admin.certificates.details.autoRenewAcme')
                                    : t('admin.certificates.details.autoRenewManual')
                            }
                        />
                        <MetadataField
                            label={t('admin.certificates.details.environment')}
                            value={
                                certificate.environment
                                    ? t(`admin.certificates.environment.${certificate.environment}`)
                                    : '—'
                            }
                        />
                        <MetadataField
                            label={t('admin.certificates.details.challengeType')}
                            value={certificateChallengeLabel(certificate.challengeType, t)}
                        />
                        <MetadataField
                            label={t('admin.certificates.columns.status')}
                            value={
                                <div className="flex flex-wrap gap-2">
                                    <span
                                        className={`${badge} ${certificateStatusClass(certificate.status)}`}
                                    >
                                        {t(`admin.certificates.status.${certificate.status}`)}
                                    </span>
                                    {certificate.candidate ? (
                                        <span className={`${badge} bg-info-bg text-info-text`}>
                                            {t('admin.certificates.status.candidate')}
                                        </span>
                                    ) : null}
                                </div>
                            }
                        />
                        <MetadataField
                            className="shell:col-span-full"
                            label={t('admin.certificates.details.san')}
                            value={
                                <div className="flex flex-wrap gap-2">
                                    {certificate.domains.length > 0 ? (
                                        certificate.domains.map((domain) => (
                                            <span className={uiClassNames.chip.item} key={domain}>
                                                {domain}
                                            </span>
                                        ))
                                    ) : (
                                        <span>—</span>
                                    )}
                                </div>
                            }
                        />
                        <MetadataField
                            label={t('admin.certificates.details.validUntil')}
                            value={formatCertificateDate(certificate.expiresAt, formatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.issuedAt')}
                            value={formatCertificateDate(certificate.issuedAt, formatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.issuer')}
                            value={certificate.issuer ?? '—'}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.fingerprint')}
                            value={
                                <span className="break-all font-mono text-xs">
                                    {certificate.fingerprint ?? '—'}
                                </span>
                            }
                        />
                        <MetadataField
                            label={t('admin.certificates.details.assignedHosts')}
                            value={certificate.assignedHostCount}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.attemptCount')}
                            value={certificate.attemptCount ?? 0}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.retryStatus')}
                            value={retryStatus}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.nextRenewalAt')}
                            value={formatDateTime(scheduling.nextRenewalAt, dateTimeFormatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.nextAttemptAt')}
                            value={formatDateTime(scheduling.nextAttemptAt, dateTimeFormatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastAttemptAt')}
                            value={formatDateTime(scheduling.lastAttemptAt, dateTimeFormatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastSuccessAt')}
                            value={formatDateTime(scheduling.lastSuccessAt, dateTimeFormatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastActivatedAt')}
                            value={formatDateTime(scheduling.lastActivatedAt, dateTimeFormatter)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastErrorAt')}
                            value={formatDateTime(scheduling.lastErrorAt, dateTimeFormatter)}
                        />
                        <MetadataField
                            className="shell:col-span-full"
                            label={t('admin.certificates.details.operationStatus')}
                            value={
                                <div className="flex flex-wrap items-center gap-2">
                                    <span
                                        className={`${badge} ${operation.stage ? certificateOperationStageClass(operation.stage) : 'bg-info-bg text-info-text'}`}
                                    >
                                        {operationStage}
                                    </span>
                                    {operation.kind ? (
                                        <span className={`${badge} bg-neutral text-muted`}>
                                            {t(
                                                `admin.certificates.operationKinds.${operation.kind}`,
                                            )}
                                        </span>
                                    ) : null}
                                </div>
                            }
                        />
                    </dl>
                </section>
                {certificate.currentOperation ? (
                    <section
                        className={uiClassNames.management.card}
                        aria-labelledby="certificate-details-operation"
                    >
                        <h2
                            id="certificate-details-operation"
                            className="text-base font-extrabold text-ink-soft"
                        >
                            {t('admin.certificates.details.currentOperation')}
                        </h2>
                        <dl className="mt-4 grid gap-4 shell:grid-cols-2">
                            <MetadataField
                                label={t('admin.certificates.details.operationId')}
                                value={
                                    <span className="break-all font-mono text-xs">
                                        {certificate.currentOperation.id}
                                    </span>
                                }
                            />
                            <MetadataField
                                label={t('admin.certificates.details.operationKind')}
                                value={t(
                                    `admin.certificates.operationKinds.${certificate.currentOperation.kind}`,
                                )}
                            />
                            <MetadataField
                                label={t('admin.certificates.details.operationStage')}
                                value={t(
                                    `admin.certificates.operationStages.${certificate.currentOperation.stage}`,
                                )}
                            />
                            <MetadataField
                                label={t('admin.certificates.details.operationStartedAt')}
                                value={formatDateTime(
                                    certificate.currentOperation.startedAt,
                                    dateTimeFormatter,
                                )}
                            />
                            <MetadataField
                                label={t('admin.certificates.details.operationUpdatedAt')}
                                value={formatDateTime(
                                    certificate.currentOperation.updatedAt,
                                    dateTimeFormatter,
                                )}
                            />
                        </dl>
                    </section>
                ) : null}
                {certificate.candidate ? (
                    <section
                        className="rounded-xl border border-info-text/20 bg-info-bg p-4"
                        aria-labelledby="certificate-details-candidate"
                    >
                        <h2 id="certificate-details-candidate" className={uiClassNames.form.label}>
                            {t('admin.certificates.details.candidate')}
                        </h2>
                        <dl className="mt-2 grid gap-3 shell:grid-cols-2">
                            <MetadataField
                                label={t('admin.certificates.details.candidateIssuedAt')}
                                value={formatCertificateDate(
                                    certificate.candidate.issuedAt,
                                    formatter,
                                )}
                            />
                            <MetadataField
                                label={t('admin.certificates.details.candidateExpiresAt')}
                                value={formatCertificateDate(
                                    certificate.candidate.expiresAt,
                                    formatter,
                                )}
                            />
                            <MetadataField
                                className="shell:col-span-full"
                                label={t('admin.certificates.details.candidateNextAttemptAt')}
                                value={formatDateTime(
                                    certificate.candidate.nextAttemptAt,
                                    dateTimeFormatter,
                                )}
                            />
                            <MetadataField
                                className="shell:col-span-full"
                                label={t('admin.certificates.details.candidateFingerprint')}
                                value={
                                    <span className="break-all font-mono text-xs">
                                        {certificate.candidate.fingerprint}
                                    </span>
                                }
                            />
                        </dl>
                    </section>
                ) : null}
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

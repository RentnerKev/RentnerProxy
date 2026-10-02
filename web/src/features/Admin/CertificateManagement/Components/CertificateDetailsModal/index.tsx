import useCertificateDetailsModalLogic from './Hooks/useCertificateDetailsModalLogic.ts'
import type { ReactNode } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { Modal } from '@/shared/Modal/index.tsx'
import type { CertificateDetailsModalProps } from './Types/certificate-details-modal.types.ts'
import { certificateOperationStageClass } from '@/lib/Admin/CertificateManagement/certificateOperations.ts'
import {
    certificateSourceClass,
    certificateStatusClass,
} from '@/lib/Admin/CertificateManagement/certificateTableCells.ts'

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
            <dt className="text-[0.82rem] font-[750] text-ink-soft">{label}</dt>
            <dd className="mt-1 break-words text-muted">{value}</dd>
        </div>
    )
}

export default function CertificateDetailsModal({
    certificate,
    onOpenChange,
    open,
}: CertificateDetailsModalProps) {
    const { t } = useTranslationStore()
    const { state } = useCertificateDetailsModalLogic(certificate)
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
                    className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
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
                            value={state.challengeLabel}
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
                                            <span
                                                className="inline-flex items-center rounded-full border border-success-text/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                                                key={domain}
                                            >
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
                            value={state.formatDate(certificate.expiresAt)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.issuedAt')}
                            value={state.formatDate(certificate.issuedAt)}
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
                            value={state.retryStatus}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.nextRenewalAt')}
                            value={state.formatDateTime(state.scheduling.nextRenewalAt)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.nextAttemptAt')}
                            value={state.formatDateTime(state.scheduling.nextAttemptAt)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastAttemptAt')}
                            value={state.formatDateTime(state.scheduling.lastAttemptAt)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastSuccessAt')}
                            value={state.formatDateTime(state.scheduling.lastSuccessAt)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastActivatedAt')}
                            value={state.formatDateTime(state.scheduling.lastActivatedAt)}
                        />
                        <MetadataField
                            label={t('admin.certificates.details.lastErrorAt')}
                            value={state.formatDateTime(state.scheduling.lastErrorAt)}
                        />
                        <MetadataField
                            className="shell:col-span-full"
                            label={t('admin.certificates.details.operationStatus')}
                            value={
                                <div className="flex flex-wrap items-center gap-2">
                                    <span
                                        className={`${badge} ${state.operation.stage ? certificateOperationStageClass(state.operation.stage) : 'bg-info-bg text-info-text'}`}
                                    >
                                        {state.operationStage}
                                    </span>
                                    {state.operation.kind ? (
                                        <span className={`${badge} bg-neutral text-muted`}>
                                            {t(
                                                `admin.certificates.operationKinds.${state.operation.kind}`,
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
                        className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
                        aria-labelledby="certificate-details-state.operation"
                    >
                        <h2
                            id="certificate-details-state.operation"
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
                                value={state.formatDateTime(certificate.currentOperation.startedAt)}
                            />
                            <MetadataField
                                label={t('admin.certificates.details.operationUpdatedAt')}
                                value={state.formatDateTime(certificate.currentOperation.updatedAt)}
                            />
                        </dl>
                    </section>
                ) : null}
                {certificate.candidate ? (
                    <section
                        className="rounded-xl border border-info-text/20 bg-info-bg p-4"
                        aria-labelledby="certificate-details-candidate"
                    >
                        <h2
                            id="certificate-details-candidate"
                            className="text-[0.82rem] font-[750] text-ink-soft"
                        >
                            {t('admin.certificates.details.candidate')}
                        </h2>
                        <dl className="mt-2 grid gap-3 shell:grid-cols-2">
                            <MetadataField
                                label={t('admin.certificates.details.candidateIssuedAt')}
                                value={state.formatDate(certificate.candidate.issuedAt)}
                            />
                            <MetadataField
                                label={t('admin.certificates.details.candidateExpiresAt')}
                                value={state.formatDate(certificate.candidate.expiresAt)}
                            />
                            <MetadataField
                                className="shell:col-span-full"
                                label={t('admin.certificates.details.candidateNextAttemptAt')}
                                value={state.formatDateTime(certificate.candidate.nextAttemptAt)}
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

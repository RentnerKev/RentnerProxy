import type { QueryClient } from '@tanstack/react-query'

import { isCertificateJobActive } from '../../../../config/certificate-jobs.config'
import {
    CERTIFICATE_ERROR_CODES,
    type CertificateOperationStage,
} from '../../../../config/certificates.config'
import type { CertificateJobSummary } from '../../../../shared/Types/certificate-jobs.types'
import { certificateJobProgressQueryKeys } from './queryKeys'

const jobStageToOperationStage = {
    preparing: 'queued',
    issuing: 'creating_order',
    applying: 'applying',
    applied: 'applied',
    failed: 'failed',
    needs_attention: 'needs_attention',
} as const satisfies Record<CertificateJobSummary['stage'], CertificateOperationStage>

export function getCertificateJobOperationStage(
    job: CertificateJobSummary,
): CertificateOperationStage {
    return job.controllerStage ?? jobStageToOperationStage[job.stage]
}

export function getCertificateJobErrorKey(job: CertificateJobSummary): string | undefined {
    if (!job.lastErrorCode) return undefined
    return (CERTIFICATE_ERROR_CODES as readonly string[]).includes(job.lastErrorCode)
        ? `admin.certificates.errors.${job.lastErrorCode}`
        : `admin.proxyHosts.certificateJob.errors.${job.lastErrorCode}`
}

export function isCertificateJobFailure(job: CertificateJobSummary): boolean {
    return (
        job.stage === 'failed' ||
        job.stage === 'needs_attention' ||
        (isCertificateJobActive(job.stage) && job.lastErrorCode !== null)
    )
}

export function isCertificateJobRetryable(job: CertificateJobSummary): boolean {
    return isCertificateJobFailure(job) && job.proxyHostId !== null && job.certificateId !== null
}

export function upsertCertificateJobProgress(
    jobs: readonly CertificateJobSummary[] | undefined,
    job: CertificateJobSummary,
): CertificateJobSummary[] {
    const current = jobs ?? []
    const index = current.findIndex((entry) => entry.id === job.id)
    if (index === -1) return [...current, job]
    return current.map((entry) => (entry.id === job.id ? job : entry))
}

export async function publishCertificateJobProgress(
    queryClient: QueryClient,
    job: CertificateJobSummary,
): Promise<void> {
    await queryClient.cancelQueries({
        queryKey: certificateJobProgressQueryKeys.all,
        exact: true,
    })
    queryClient.setQueryData<CertificateJobSummary[]>(
        certificateJobProgressQueryKeys.all,
        (current) => upsertCertificateJobProgress(current, job),
    )
    void queryClient
        .invalidateQueries({
            queryKey: certificateJobProgressQueryKeys.all,
            exact: true,
        })
        .catch(() => undefined)
}

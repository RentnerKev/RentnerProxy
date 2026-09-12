import '@tanstack/react-start/server-only'

import { eq } from 'drizzle-orm'
import { certificateJobs } from '../../../db/schema'
import { requestCertificateInputSchema } from '../../../features/Admin/CertificateManagement/validation'
import { decryptSecret } from '../../Auth/Core/encryption.server'
import {
    getControllerCertificate,
    issueControllerCertificate,
    renewControllerCertificate,
    type ControllerCertificateMetadata,
} from '../../Foundation/certificates.server'
import { CertificateDomainError } from '../CertificateManagement/certificates.errors'
import { persistControllerCertificatesMetadataInTransaction } from '../CertificateManagement/certificates.service'
import {
    bindIssuedJobCertificate,
    certificateJobRuntime,
    confirmJobRuntime,
} from './certificate-jobs.binding.server'
import {
    claimCertificateJob,
    releaseCertificateJob,
    withCertificateJobClaim,
} from './certificate-jobs.lease.server'
import {
    CertificateJobDomainError,
    certificateJobDigest,
    validateCertificateJobContext,
    type CertificateJobRow,
} from './certificate-jobs.storage.server'

export const certificateJobController = {
    get: getControllerCertificate,
    issue: issueControllerCertificate,
    renew: renewControllerCertificate,
}

async function saveJobCertificateMetadata(
    job: CertificateJobRow,
    metadata: ControllerCertificateMetadata,
): Promise<void> {
    await withCertificateJobClaim(job, async (transaction, current) => {
        await validateCertificateJobContext(transaction, current)
        await persistControllerCertificatesMetadataInTransaction(transaction, [metadata], false)
        await transaction
            .update(certificateJobs)
            .set({
                stage: metadata.status === 'failed' && !metadata.candidate ? 'failed' : 'issuing',
                controllerStage: metadata.currentOperation?.stage ?? null,
                controllerOperationId:
                    metadata.currentOperation?.id ?? current.controllerOperationId,
                lastErrorCode: metadata.candidate?.lastErrorCode ?? metadata.lastErrorCode,
                retryRequested: false,
                updatedAt: new Date(),
            })
            .where(eq(certificateJobs.id, current.id))
    })
}

async function issueJobCertificate(
    job: CertificateJobRow,
    controller: typeof certificateJobController,
): Promise<ControllerCertificateMetadata | null> {
    const dispatch = await withCertificateJobClaim(job, async (transaction, current) => {
        await validateCertificateJobContext(transaction, current)
        if (!current.requestCiphertext || !current.requestIv || !current.certificateId)
            throw new CertificateJobDomainError('dns_credentials_unavailable')
        const plaintext = await decryptSecret(
            { ciphertext: current.requestCiphertext, iv: current.requestIv },
            'certificate-binding-job:' + current.id,
        )
        const request = requestCertificateInputSchema.parse(JSON.parse(plaintext))
        if (
            certificateJobDigest(request.domains.toSorted()) !==
            certificateJobDigest(current.domains)
        )
            throw new CertificateJobDomainError('domain_mismatch')
        await transaction
            .update(certificateJobs)
            .set({ stage: 'issuing', updatedAt: new Date() })
            .where(eq(certificateJobs.id, current.id))
        return { request, certificateId: current.certificateId }
    })
    return dispatch ? controller.issue(dispatch.certificateId, dispatch.request) : null
}

async function loadOrIssueJobCertificate(
    job: CertificateJobRow,
    controller: typeof certificateJobController,
): Promise<ControllerCertificateMetadata | null> {
    if (!job.certificateId) throw new CertificateJobDomainError('certificate_deleted')
    let metadata: ControllerCertificateMetadata
    try {
        metadata = await controller.get(job.certificateId)
    } catch (error) {
        if (!(error instanceof CertificateDomainError) || error.code !== 'certificate_not_found')
            throw error
        if (job.controllerOperationId || job.assignedRevision)
            throw new CertificateJobDomainError('certificate_not_found')
        return issueJobCertificate(job, controller)
    }
    if (metadata.candidate && job.retryRequested) return controller.renew(job.certificateId)
    if (
        metadata.status !== 'valid' &&
        metadata.operation === 'idle' &&
        !metadata.candidate &&
        job.retryRequested &&
        (metadata.currentOperation?.id ?? null) === job.controllerOperationId
    ) {
        return issueJobCertificate(job, controller)
    }
    return metadata
}

export async function processCertificateJob(
    job: CertificateJobRow,
    controller = certificateJobController,
    runtime = certificateJobRuntime,
): Promise<void> {
    try {
        const ready = await withCertificateJobClaim(job, async (transaction, current) => {
            await validateCertificateJobContext(transaction, current)
            return true
        })
        if (!ready) return
        const metadata = await loadOrIssueJobCertificate(job, controller)
        if (!metadata) return
        if (metadata.status === 'valid' && !metadata.candidate) {
            if (!(await bindIssuedJobCertificate(job, metadata))) return
            if (await confirmJobRuntime(job, runtime)) return
            await releaseCertificateJob(job, {
                stage: 'applying',
                lastErrorCode: 'runtime_apply_failed',
                retryRequested: false,
            })
            return
        }
        await saveJobCertificateMetadata(job, metadata)
        await releaseCertificateJob(job)
    } catch (error) {
        if (error instanceof CertificateJobDomainError) {
            await releaseCertificateJob(job, {
                stage: 'needs_attention',
                lastErrorCode: error.code,
                retryRequested: false,
            })
            return
        }
        const code = error instanceof CertificateDomainError ? error.code : 'controller_unavailable'
        const temporary =
            code === 'controller_unavailable' ||
            code === 'operation_in_progress' ||
            code === 'certificate_store_unavailable' ||
            code === 'runtime_apply_failed'
        await releaseCertificateJob(job, {
            ...(temporary ? {} : { stage: 'failed' }),
            lastErrorCode: code,
        })
    }
}

export async function runCertificateJobsOnce(
    controller = certificateJobController,
    runtime = certificateJobRuntime,
): Promise<void> {
    const jobs = await Promise.all(Array.from({ length: 4 }, () => claimCertificateJob()))
    await Promise.all(
        jobs
            .filter((job): job is CertificateJobRow => job !== null)
            .map((job) => processCertificateJob(job, controller, runtime)),
    )
}

let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let stopped = true

export function startCertificateJobWorker(): void {
    if (!stopped) return
    stopped = false
    const tick = () => {
        if (stopped) return
        running = runCertificateJobsOnce()
            .catch(() => undefined)
            .finally(() => {
                running = null
                if (!stopped) {
                    timer = setTimeout(tick, 5_000)
                    timer.unref()
                }
            })
    }
    tick()
}

export async function stopCertificateJobWorker(): Promise<void> {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
    await running
}

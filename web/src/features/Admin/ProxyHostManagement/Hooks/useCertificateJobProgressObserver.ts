import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
    CERTIFICATE_JOB_SUCCESS_TOAST_DURATION_MS,
    isCertificateJobActive,
} from '../../../../config/certificate-jobs.config'
import { PERMISSIONS, type PermissionKey } from '../../../../config/permissions.config'
import useLiveInvalidation from '../../../../shared/Live/useLiveInvalidation'
import useToast from '../../../../shared/Toast/Hooks/useToast'
import type { ToastAction, ToastTone } from '../../../../shared/Toast/Types/toast.types'
import type { CertificateJobSummary } from '../../../../shared/Types/certificate-jobs.types'
import { certificateManagementQueryKeys } from '../../CertificateManagement/queryKeys'
import {
    getCertificateJobErrorKey,
    getCertificateJobOperationStage,
    isCertificateJobFailure,
    isCertificateJobRetryable,
    publishCertificateJobProgress,
} from '../CertificateJobs/certificateJobProgress'
import { certificateJobProgressQueryKeys } from '../CertificateJobs/queryKeys'
import {
    getCertificateJobProgressHandler,
    retryCertificateJobHandler,
} from '../CertificateJobs/server'
import { proxyHostManagementQueryKeys } from '../queryKeys'

const EMPTY_JOBS: CertificateJobSummary[] = []
const LIVE_QUERY_KEYS = [
    certificateJobProgressQueryKeys.all,
    proxyHostManagementQueryKeys.all,
    proxyHostManagementQueryKeys.runtimeStatus,
    certificateManagementQueryKeys.all,
] as const

function taskId(jobId: string): string {
    return `certificate-job-${jobId}`
}

function jobSignature(
    job: CertificateJobSummary,
    canRetry: boolean,
    canViewCertificate: boolean,
): string {
    return [
        job.stage,
        job.controllerStage ?? '',
        job.lastErrorCode ?? '',
        job.domains.join(','),
        canRetry && isCertificateJobRetryable(job) ? 'retry' : '',
        canViewCertificate && job.certificateId ? `view:${job.certificateId}` : '',
    ].join(':')
}

export default function useCertificateJobProgressObserver(
    permissions: readonly PermissionKey[],
): void {
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canView = permissionSet.has(PERMISSIONS.PROXY_HOSTS_VIEW)
    const canRetry = permissionSet.has(PERMISSIONS.CERTIFICATES_ISSUE)
    const canViewCertificate = permissionSet.has(PERMISSIONS.CERTIFICATES_VIEW)
    const toast = useToast()
    const queryClient = useQueryClient()
    const initialized = useRef(false)
    const signatures = useRef(new Map<string, string>())
    const jobsQuery = useQuery({
        queryKey: certificateJobProgressQueryKeys.all,
        queryFn: () => getCertificateJobProgressHandler(),
        enabled: canView,
    })
    const jobs = jobsQuery.data ?? EMPTY_JOBS

    useLiveInvalidation({
        topic: 'proxy-hosts',
        query: {},
        enabled: canView && jobs.some((job) => isCertificateJobActive(job.stage)),
        queryKeys: LIVE_QUERY_KEYS,
    })

    const retry = useCallback(
        async (jobId: string) => {
            try {
                const result = await retryCertificateJobHandler({ data: { jobId } })
                if (!result.success) {
                    toast.error(result.message)
                    return
                }
                await publishCertificateJobProgress(queryClient, result.job)
                await Promise.all(
                    LIVE_QUERY_KEYS.slice(1).map((queryKey) =>
                        queryClient.invalidateQueries({ queryKey }),
                    ),
                )
            } catch {
                toast.error('admin.proxyHosts.certificateJob.errors.actionFailed')
            }
        },
        [queryClient, toast],
    )

    useEffect(() => {
        if (!canView || !jobsQuery.data) {
            if (!canView) {
                for (const jobId of signatures.current.keys()) toast.remove(taskId(jobId))
                signatures.current.clear()
                initialized.current = false
            }
            return
        }

        const initialLoad = !initialized.current
        const currentIds = new Set<string>()
        for (const job of jobsQuery.data) {
            currentIds.add(job.id)
            const signature = jobSignature(job, canRetry, canViewCertificate)
            if (signatures.current.get(job.id) === signature) continue
            signatures.current.set(job.id, signature)

            if (initialLoad && job.stage === 'applied') continue

            const failure = isCertificateJobFailure(job)
            const actions: ToastAction[] = []
            if (canRetry && isCertificateJobRetryable(job)) {
                actions.push({
                    id: 'retry',
                    label: 'admin.proxyHosts.certificateJob.background.retry',
                    onSelect: () => retry(job.id),
                })
            }
            if (canViewCertificate && job.certificateId) {
                actions.push({
                    id: 'view-certificate',
                    label: 'admin.proxyHosts.certificateJob.background.viewCertificate',
                    href: '/certificates',
                })
            }

            const tone: ToastTone = job.stage === 'applied' ? 'success' : failure ? 'error' : 'info'
            toast.upsert(
                taskId(job.id),
                job.stage === 'applied'
                    ? 'admin.proxyHosts.certificateJob.background.success'
                    : `admin.certificates.operationStages.${getCertificateJobOperationStage(job)}`,
                tone,
                {
                    title: 'admin.proxyHosts.certificateJob.background.title',
                    context: job.domains.join(', '),
                    actions,
                    persistent: job.stage !== 'applied',
                    dismissible: job.stage === 'applied' || failure,
                    activity: job.stage === 'applied' || failure ? 'none' : 'running',
                    ...(job.stage === 'applied'
                        ? { duration: CERTIFICATE_JOB_SUCCESS_TOAST_DURATION_MS }
                        : {}),
                    ...(failure
                        ? {
                              detail:
                                  getCertificateJobErrorKey(job) ??
                                  'admin.proxyHosts.certificateJob.background.failure',
                          }
                        : {}),
                },
            )
        }

        for (const jobId of signatures.current.keys()) {
            if (currentIds.has(jobId)) continue
            signatures.current.delete(jobId)
            toast.remove(taskId(jobId))
        }
        initialized.current = true
    }, [canRetry, canView, canViewCertificate, jobsQuery.data, retry, toast])
}

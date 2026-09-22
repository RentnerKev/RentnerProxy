import { toast } from '@rentnerkev/toasts/toast'
import type { ToastId, ToastType } from '@rentnerkev/toasts/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import {
    CERTIFICATE_JOB_SUCCESS_TOAST_DURATION_MS,
    isCertificateJobActive,
} from '../../../../config/certificate-jobs.config'
import { PERMISSIONS, type PermissionKey } from '../../../../config/permissions.config'
import useTranslationStore, { type Translate } from '../../../../language/useTranslationStore'
import useLiveInvalidation from '../../../../shared/Live/useLiveInvalidation'
import type { CertificateJobSummary } from '../../../../shared/Types/certificate-jobs.types'
import { certificateManagementQueryKeys } from '../../CertificateManagement/queryKeys'
import {
    getCertificateJobErrorKey,
    getCertificateJobOperationStage,
    isCertificateJobFailure,
} from '../CertificateJobs/certificateJobProgress'
import { certificateJobProgressQueryKeys } from '../CertificateJobs/queryKeys'
import { getCertificateJobProgressHandler } from '../CertificateJobs/server'
import { proxyHostManagementQueryKeys } from '../queryKeys'

const EMPTY_JOBS: CertificateJobSummary[] = []
const LIVE_QUERY_KEYS = [
    certificateJobProgressQueryKeys.all,
    proxyHostManagementQueryKeys.all,
    proxyHostManagementQueryKeys.runtimeStatus,
    certificateManagementQueryKeys.all,
] as const

function jobSignature(job: CertificateJobSummary, language: string): string {
    return [
        language,
        job.stage,
        job.controllerStage ?? '',
        job.lastErrorCode ?? '',
        job.domains.join(','),
    ].join(':')
}

function getJobToastContent(job: CertificateJobSummary, t: Translate): string {
    const messageKey =
        job.stage === 'applied'
            ? 'admin.proxyHosts.certificateJob.background.success'
            : `admin.certificates.operationStages.${getCertificateJobOperationStage(job)}`
    const parts = [job.domains.join(', '), t(messageKey, { defaultValue: messageKey })]

    if (isCertificateJobFailure(job)) {
        const detailKey =
            getCertificateJobErrorKey(job) ?? 'admin.proxyHosts.certificateJob.background.failure'
        parts.push(t(detailKey, { defaultValue: detailKey }))
    }

    return parts.join(' · ')
}

export default function useCertificateJobProgressObserver(
    permissions: readonly PermissionKey[],
): void {
    const permissionSet = useMemo(() => new Set(permissions), [permissions])
    const canView = permissionSet.has(PERMISSIONS.PROXY_HOSTS_VIEW)
    const { language, t } = useTranslationStore()
    const initialized = useRef(false)
    const signatures = useRef(new Map<string, string>())
    const taskToastIds = useRef(new Map<string, ToastId>())
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

    useEffect(() => {
        if (!canView || !jobsQuery.data) {
            if (!canView) {
                for (const toastId of taskToastIds.current.values()) toast.dismiss(toastId)
                signatures.current.clear()
                taskToastIds.current.clear()
                initialized.current = false
            }
            return
        }

        const initialLoad = !initialized.current
        const currentIds = new Set<string>()
        for (const job of jobsQuery.data) {
            currentIds.add(job.id)
            const signature = jobSignature(job, language)
            if (signatures.current.get(job.id) === signature) continue
            signatures.current.set(job.id, signature)

            if (initialLoad && job.stage === 'applied') continue

            const failure = isCertificateJobFailure(job)
            const tone: ToastType = job.stage === 'applied' ? 'success' : failure ? 'error' : 'info'
            const content = getJobToastContent(job, t)
            const options = {
                title: t('admin.proxyHosts.certificateJob.background.title'),
                duration: job.stage === 'applied' ? CERTIFICATE_JOB_SUCCESS_TOAST_DURATION_MS : 0,
            }
            const currentToastId = taskToastIds.current.get(job.id)

            if (
                currentToastId &&
                toast.update(currentToastId, { content, type: tone, ...options })
            ) {
                continue
            }

            taskToastIds.current.set(job.id, toast[tone](content, options))
        }

        for (const jobId of signatures.current.keys()) {
            if (currentIds.has(jobId)) continue
            signatures.current.delete(jobId)
            const toastId = taskToastIds.current.get(jobId)
            if (toastId) toast.dismiss(toastId)
            taskToastIds.current.delete(jobId)
        }
        initialized.current = true
    }, [canView, jobsQuery.data, language, t])
}

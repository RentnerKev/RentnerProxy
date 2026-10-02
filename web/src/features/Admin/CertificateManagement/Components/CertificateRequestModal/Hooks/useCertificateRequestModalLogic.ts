import type { FormEvent } from 'react'

import { isCertificateJobActive } from '@/lib/CertificateJobs/stages.ts'
import type { CertificateRequestModalProps } from '../Types/certificate-request-modal.types.ts'
import useCertificateRequest from '../../../Hooks/useCertificateRequest.ts'

export default function useCertificateRequestModalLogic(props: CertificateRequestModalProps) {
    const { form, formId, isPending, readOnlyDomains, retryableJob } = useCertificateRequest({
        certificateJob: props.certificateJob,
        expectedUpdatedAt: props.expectedUpdatedAt,
        initialDomains: props.initialDomains,
        initialName: props.initialName,
        proxyHostId: props.proxyHostId,
        readOnlyDomains: props.readOnlyDomains,
        onSuccess: props.onSuccess,
    })
    const job = props.certificateJob
    const jobActive = job ? isCertificateJobActive(job.stage) : false
    const jobStage =
        job?.controllerStage ??
        (job
            ? (
                  {
                      preparing: 'queued',
                      issuing: 'creating_order',
                      applying: 'applying',
                      applied: 'applied',
                      failed: 'failed',
                      needs_attention: 'needs_attention',
                  } as const
              )[job.stage]
            : null)
    return {
        state: { formId, isPending, readOnlyDomains, retryableJob, jobActive, jobStage },
        handler: {
            handleClose: () => props.onOpenChange(false),
            handleSubmit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                event.stopPropagation()
                void form.handleSubmit()
            },
        },
        form,
    }
}

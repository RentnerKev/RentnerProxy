import type { FormEvent } from 'react'
import { useCallback } from 'react'
import { useStore } from '@tanstack/react-form'

import { isCertificateJobActive } from '@/lib/CertificateJobs/stages.ts'
import type { CertificateRequestModalProps } from '../Types/certificate-request-modal.types.ts'
import useCertificateRequest from '../../../Hooks/useCertificateRequest.ts'
import useManualDnsRequestSetup from './useManualDnsRequestSetup.ts'

export default function useCertificateRequestModalLogic(props: CertificateRequestModalProps) {
    const {
        form,
        formId,
        isPending,
        getRequestInput,
        reportValidationError,
        readOnlyDomains,
        retryableJob,
    } = useCertificateRequest({
        certificateJob: props.certificateJob,
        expectedUpdatedAt: props.expectedUpdatedAt,
        initialDomains: props.initialDomains,
        initialName: props.initialName,
        proxyHostId: props.proxyHostId,
        readOnlyDomains: props.readOnlyDomains,
        onSuccess: props.onSuccess,
    })
    const manualMode = useStore(
        form.store,
        (value) => value.values.challengeType === 'dns-01' && value.values.dnsMode === 'manual',
    )
    const manualSetupAvailable = !props.proxyHostId && !props.certificateJob
    const manualSetupRequired = manualSetupAvailable && manualMode
    const getSetupInput = useCallback(
        () => getRequestInput({ ...form.state.values, acceptTerms: true }),
        [form, getRequestInput],
    )
    const reportSetupValidationError = useCallback(
        () => reportValidationError({ ...form.state.values, acceptTerms: true }),
        [form, reportValidationError],
    )
    const manualSetup = useManualDnsRequestSetup({
        enabled: manualSetupRequired,
        getInput: getSetupInput,
        reportValidationError: reportSetupValidationError,
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
        state: {
            formId,
            isPending: isPending || manualSetup.busy,
            readOnlyDomains,
            retryableJob,
            jobActive,
            jobStage,
            manualSetupAvailable,
            manualSetupRequired,
            requestDisabled: manualSetupRequired && !manualSetup.canRequest,
            inputsLocked: manualSetupRequired && manualSetup.hasPrepared,
        },
        handler: {
            handleClose: () => props.onOpenChange(false),
            handleSubmit: (event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                event.stopPropagation()
                if (manualSetupRequired) {
                    if (!manualSetup.hasPrepared) manualSetup.openGuide()
                    else void manualSetup.submit()
                    return
                }
                if (!retryableJob) form.setFieldValue('acceptTerms', true)
                // Revalidate array-level errors after a child domain has been corrected.
                void Promise.resolve(form.validate('submit')).then(() => form.handleSubmit())
            },
        },
        form,
        manualSetup,
    }
}

import type { FormEvent } from 'react'
import type useCertificateRequestModalLogic from '../Hooks/useCertificateRequestModalLogic.ts'
import type { CertificateRequestInputs } from '../../../Types/certificate-management.types.ts'

export interface CertificateRequestModalProps extends CertificateRequestInputs {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

export interface CertificateRequestModalLogicResult {
    readonly form: ReturnType<typeof useCertificateRequestModalLogic>['form']
    readonly state: {
        readonly formId: string
        readonly isPending: boolean
        readonly readOnlyDomains: boolean
        readonly retryableJob: boolean
        readonly jobActive: boolean
        readonly jobStage: string | null
    }
    readonly handler: {
        readonly handleClose: () => void
        readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
    }
}

export interface CertificateRequestFieldsProps {
    readonly form: CertificateRequestModalLogicResult['form']
    readonly isPending: boolean
    readonly readOnlyDomains?: boolean
}

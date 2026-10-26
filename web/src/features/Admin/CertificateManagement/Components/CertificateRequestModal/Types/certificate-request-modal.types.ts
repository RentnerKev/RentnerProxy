import type { FormEvent } from 'react'
import type useCertificateRequestModalLogic from '../Hooks/useCertificateRequestModalLogic.ts'
import type { CertificateRequestInputs } from '../../../Types/certificate-management.types.ts'
import type useManualDnsRequestSetup from '../Hooks/useManualDnsRequestSetup.ts'

export interface CertificateRequestModalProps extends CertificateRequestInputs {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

export interface CertificateRequestModalLogicResult {
    readonly form: ReturnType<typeof useCertificateRequestModalLogic>['form']
    readonly manualSetup: ReturnType<typeof useManualDnsRequestSetup>
    readonly state: {
        readonly formId: string
        readonly isPending: boolean
        readonly readOnlyDomains: boolean
        readonly retryableJob: boolean
        readonly jobActive: boolean
        readonly jobStage: string | null
        readonly manualSetupAvailable: boolean
        readonly manualSetupRequired: boolean
        readonly requestDisabled: boolean
        readonly inputsLocked: boolean
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
    readonly locked?: boolean
    readonly onSetupManualDns?: (() => void) | undefined
}

export interface CertificateProviderFieldsProps {
    readonly form: CertificateRequestFieldsProps['form']
    readonly disabled: boolean
}

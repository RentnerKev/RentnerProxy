import type { FormEvent } from 'react'
import type useCertificateImportLogic from '../Hooks/useCertificateImportLogic.ts'
import type { CertificateSummary } from '@/shared/Types/certificates.types.ts'

export interface CertificateImportModalProps {
    readonly certificate?: CertificateSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void | Promise<void>
}

export interface CertificateImportLogicResult {
    readonly form: ReturnType<typeof useCertificateImportLogic>['form']
    readonly state: {
        readonly formId: string
        readonly isPending: boolean
        readonly isReplace: boolean
    }
    readonly handler: {
        readonly handleClose: () => void
        readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
    }
}

export interface CertificateImportFieldsProps {
    readonly form: CertificateImportLogicResult['form']
    readonly isPending: boolean
}

import type { FormEvent } from 'react'
import type useTrustedCaImportLogic from '../Hooks/useTrustedCaImportLogic.ts'
import type { TrustedCaSummary } from '@/lib/Admin/TrustedCaManagement/Types/trusted-cas.types.ts'

export interface TrustedCaImportModalProps {
    readonly trustedCa?: TrustedCaSummary
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSuccess: () => void | Promise<void>
}

export interface TrustedCaImportLogicResult {
    readonly form: ReturnType<typeof useTrustedCaImportLogic>['form']
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

import type { FormEventHandler } from 'react'
import type { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
export interface TotpSetupModalLogicResult<TForm> {
    form: TForm
    state: { step: 'scan' | 'verify' }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        handleOpenChange: (open: boolean) => void
        validateCode: (context: { value: string }) => ReturnType<typeof getValidationIssue>
        back: () => void
        close: () => void
        normalizeCode: (value: string) => string
        verify: () => void
    }
}

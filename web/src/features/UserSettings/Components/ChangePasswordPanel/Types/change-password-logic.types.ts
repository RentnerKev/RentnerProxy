import type { getValidationIssue } from '@/lib/Forms/fieldErrors.ts'
import type { FormEventHandler } from 'react'
export interface ChangePasswordLogicResult<TForm> {
    form: TForm
    state: { isPending: boolean }
    handler: {
        handleSubmit: FormEventHandler<HTMLFormElement>
        validateCurrentPassword: (context: {
            value: string
        }) => ReturnType<typeof getValidationIssue>
        validatePassword: (context: { value: string }) => ReturnType<typeof getValidationIssue>
        validateConfirmPassword: (context: { value: string }) => string | undefined
    }
}

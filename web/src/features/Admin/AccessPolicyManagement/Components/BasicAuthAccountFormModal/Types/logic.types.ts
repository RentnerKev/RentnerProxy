import type {
    BasicAuthAccountFormErrors,
    BasicAuthAccountFormValues,
} from '../../../Types/basic-auth.types.ts'

export interface BasicAuthAccountFormLogicResult {
    readonly state: {
        readonly errors: BasicAuthAccountFormErrors
        readonly formId: string
        readonly isPending: boolean
        readonly values: BasicAuthAccountFormValues
    }
    readonly handler: {
        readonly handleOpenChange: (open: boolean) => void
        readonly setPassword: (password: string) => void
        readonly setUsername: (username: string) => void
        readonly submit: () => Promise<void>
    }
}

import type { BasicAuthAccountFormErrors } from '../../../Types/basic-auth.types.ts'

export type ActionResult = {
    readonly success: boolean
    readonly message: string
    readonly runtimeStatus?: 'applied' | 'pending'
}

export type FormErrors = {
    name?: string | undefined
    combination?: string | undefined
    ipRules?: string | undefined
    forwardAuth?: string | undefined
    basicAuth?: BasicAuthAccountFormErrors | undefined
}

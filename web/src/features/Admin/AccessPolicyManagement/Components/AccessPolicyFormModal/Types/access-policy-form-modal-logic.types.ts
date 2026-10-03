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
}

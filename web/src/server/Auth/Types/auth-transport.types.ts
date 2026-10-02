export interface AuthActionResult {
    readonly success: boolean
    readonly message: string
}

export interface AuthActionFailureResult extends AuthActionResult {
    readonly success: false
}

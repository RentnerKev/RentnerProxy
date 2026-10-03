export interface ControllerRequestOptions {
    readonly timeoutMs: number
    readonly privileged?: boolean
    readonly confidential?: boolean
    readonly body?: string
    readonly method?: 'GET' | 'PUT' | 'POST' | 'DELETE'
    readonly responseLimit?: number
    readonly allowNotFound?: boolean
    readonly acceptErrorResponse?: boolean
    readonly acceptNonOkJson?: boolean
}

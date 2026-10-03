export interface ValidationIssue {
    readonly code?: string
    readonly message?: string
    readonly origin?: string
    readonly format?: string
    readonly minimum?: number | bigint
    readonly maximum?: number | bigint
    readonly path?: readonly PropertyKey[]
}

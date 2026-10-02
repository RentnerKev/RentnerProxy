export type CaddyConfigTokenKind =
    | 'key'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'punctuation'
    | 'plain'

export interface CaddyConfigToken {
    readonly kind: CaddyConfigTokenKind
    readonly start: number
    readonly value: string
}

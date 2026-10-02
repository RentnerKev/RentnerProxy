import type { CaddyConfigTokenKind } from '@/lib/CodeHighlighting/Types/caddy-config.types.ts'

export interface CaddyConfigCodeBlockProps {
    readonly source: string
    readonly ariaLabel: string
}
export interface CaddyConfigCodeBlockLogicResult {
    readonly state: {
        readonly tokens: readonly {
            readonly kind: CaddyConfigTokenKind
            readonly value: string
            readonly key: string
            readonly className: string
        }[]
    }
}

import { useMemo } from 'react'
import { formatCaddyConfig, tokenizeCaddyConfig } from '@/lib/CodeHighlighting/caddyConfig.ts'
import type { CaddyConfigTokenKind } from '@/lib/CodeHighlighting/Types/caddy-config.types.ts'
import type { CaddyConfigCodeBlockLogicResult } from '../Types/caddy-config-code-block.types.ts'

const TOKEN_CLASS_NAMES: Record<CaddyConfigTokenKind, string> = {
    key: 'text-accent-ring',
    string: 'text-info-text',
    number: 'text-warning-text',
    boolean: 'text-success-text',
    null: 'text-muted',
    punctuation: 'text-muted',
    plain: 'text-ink-soft',
}

export default function useCaddyConfigCodeBlockLogic(
    source: string,
): CaddyConfigCodeBlockLogicResult {
    const tokens = useMemo(
        () =>
            tokenizeCaddyConfig(formatCaddyConfig(source)).map((token) => ({
                kind: token.kind,
                value: token.value,
                key: `${token.kind}-${token.start}`,
                className: TOKEN_CLASS_NAMES[token.kind],
            })),
        [source],
    )
    return { state: { tokens } }
}

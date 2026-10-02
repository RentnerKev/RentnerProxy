import type { CaddyConfigCodeBlockProps } from './Types/caddy-config-code-block.types.ts'
import useCaddyConfigCodeBlockLogic from './Hooks/useCaddyConfigCodeBlockLogic.ts'

export default function CaddyConfigCodeBlock({ source, ariaLabel }: CaddyConfigCodeBlockProps) {
    const { state } = useCaddyConfigCodeBlockLogic(source)
    return (
        <pre
            className="max-h-96 overflow-auto rounded-xl border border-border bg-code p-3 font-mono text-xs leading-relaxed"
            aria-label={ariaLabel}
        >
            <code>
                {state.tokens.map((token) => (
                    <span key={token.key} className={token.className} data-token={token.kind}>
                        {token.value}
                    </span>
                ))}
            </code>
        </pre>
    )
}

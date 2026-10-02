import { forwardRef } from 'react'
import type { ManagedDomainLinkProps } from './Types/managed-domain.types.ts'
import useManagedDomainLinkLogic from './Hooks/useManagedDomainLinkLogic.ts'

const ManagedDomainLink = forwardRef<HTMLAnchorElement, ManagedDomainLinkProps>(
    function ManagedDomainLink(
        { className = '', domain, onClick, onKeyDown, onPointerDown, ...anchorProps },
        ref,
    ) {
        const { state, handler } = useManagedDomainLinkLogic({
            domain,
            onClick,
            onKeyDown,
            onPointerDown,
        })
        if (!state.href) return <span className={className}>{domain}</span>

        return (
            <a
                {...anchorProps}
                ref={ref}
                href={state.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={state.ariaLabel}
                className={`${className} cursor-pointer decoration-brand-500/70 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring`}
                onClick={handler.handleClick}
                onKeyDown={handler.handleKeyDown}
                onPointerDown={handler.handlePointerDown}
            >
                {domain}
            </a>
        )
    },
)

export default ManagedDomainLink

import { forwardRef } from 'react'
import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent, PointerEvent } from 'react'

import useTranslationStore from '../../language/useTranslationStore'
import { getManagedDomainHref } from './managedDomain'

interface ManagedDomainLinkProps extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'children' | 'href'
> {
    readonly domain: string
}

function stopPropagation(event: KeyboardEvent | MouseEvent | PointerEvent): void {
    event.stopPropagation()
}

const ManagedDomainLink = forwardRef<HTMLAnchorElement, ManagedDomainLinkProps>(
    function ManagedDomainLink(
        { className = '', domain, onClick, onKeyDown, onPointerDown, ...anchorProps },
        ref,
    ) {
        const { t } = useTranslationStore()
        const href = getManagedDomainHref(domain)
        if (!href) return <span className={className}>{domain}</span>

        return (
            <a
                {...anchorProps}
                ref={ref}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('common.openDomainInNewTab', { domain })}
                className={`${className} cursor-pointer decoration-brand-500/70 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500`}
                onClick={(event) => {
                    stopPropagation(event)
                    onClick?.(event)
                }}
                onKeyDown={(event) => {
                    stopPropagation(event)
                    onKeyDown?.(event)
                }}
                onPointerDown={(event) => {
                    stopPropagation(event)
                    onPointerDown?.(event)
                }}
            >
                {domain}
            </a>
        )
    },
)

export default ManagedDomainLink

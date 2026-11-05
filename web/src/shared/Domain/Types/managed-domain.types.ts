import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent, PointerEvent } from 'react'

export interface ManagedDomainLinkProps extends Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    'children' | 'href'
> {
    readonly domain: string
    readonly allowLinks?: boolean
    readonly scheme?: 'http' | 'https'
}

export type ManagedDomainLinkLogicParams = Pick<
    ManagedDomainLinkProps,
    'domain' | 'scheme' | 'allowLinks' | 'onClick' | 'onKeyDown' | 'onPointerDown'
>

export interface ManagedDomainLinkLogicResult {
    readonly state: {
        readonly href: string | null
        readonly ariaLabel: string
    }
    readonly handler: {
        readonly handleClick: (event: MouseEvent<HTMLAnchorElement>) => void
        readonly handleKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void
        readonly handlePointerDown: (event: PointerEvent<HTMLAnchorElement>) => void
    }
}

export interface ManagedDomainOverflowProps {
    readonly ariaLabel: string
    readonly domains: ReadonlyArray<string>
    readonly allowLinks?: boolean
    readonly scheme?: 'http' | 'https'
    readonly tone?: 'success' | 'danger'
    readonly descriptionId?: string | undefined
}

export interface ManagedDomainOverflowLogicResult {
    readonly handler: {
        readonly handleStopPropagation: (event: KeyboardEvent | MouseEvent | PointerEvent) => void
    }
}

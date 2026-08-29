import type { ReactElement, ReactNode } from 'react'

export interface TooltipProviderProps {
    readonly children: ReactNode
}

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

export interface TooltipProps {
    readonly children: ReactElement
    readonly content: ReactNode
    readonly side?: TooltipSide
}

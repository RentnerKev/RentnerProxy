import type { ReactNode } from 'react'

export interface ActionMenuItem {
    readonly description?: ReactNode
    readonly destructive?: boolean
    readonly disabled?: boolean
    readonly label: string
    readonly onSelect: () => void
}

export interface ActionMenuProps {
    readonly ariaLabel?: string
    readonly items: readonly ActionMenuItem[]
}

export interface ActionMenuItemViewProps {
    readonly item: ActionMenuItem
}

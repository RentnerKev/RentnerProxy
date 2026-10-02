import type { RefObject, PointerEvent, KeyboardEvent } from 'react'
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
    readonly openOnHover?: boolean
}

export interface ActionMenuItemViewProps {
    readonly item: ActionMenuItem
}

export interface ActionMenuLogicResult {
    readonly state: { readonly openOnHover: boolean; readonly open: boolean }
    readonly refs: {
        readonly trigger: RefObject<HTMLButtonElement | null>
        readonly content: RefObject<HTMLDivElement | null>
    }
    readonly handler: {
        readonly handlePointerEnter: (event: PointerEvent<HTMLElement>) => void
        readonly handlePointerLeave: (event: PointerEvent<HTMLElement>) => void
        readonly handleKeyDown: (event: KeyboardEvent<HTMLElement>) => void
        readonly handleOpenChange: (open: boolean) => void
        readonly handleOpenAutoFocus: (event: Event) => void
        readonly handleCloseAutoFocus: (event: Event) => void
    }
}

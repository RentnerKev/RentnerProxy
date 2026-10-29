import type { MenuItem } from '@rentnerkev/menu'

export interface ActionMenuItem {
    readonly id: string
    readonly description?: string
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

export interface ActionMenuLogicResult {
    readonly state: {
        readonly open: boolean
        readonly items: readonly MenuItem[]
    }
    readonly handler: {
        readonly handleOpenChange: (open: boolean) => void
        readonly handleAction: (id: string) => void
    }
}

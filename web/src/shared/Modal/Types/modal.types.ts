import type { ReactNode } from 'react'

export type ModalSize = 'sm' | 'md' | 'lg'

export interface ModalProps {
    readonly children?: ReactNode
    readonly closeDisabled?: boolean
    readonly description: ReactNode
    readonly footer?: ReactNode
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly size?: ModalSize
    readonly title: ReactNode
}

export interface ConfirmDialogProps {
    readonly cancelLabel?: string
    readonly confirmLabel?: string
    readonly description: ReactNode
    readonly destructive?: boolean
    readonly isPending?: boolean
    readonly onConfirm: () => void | Promise<void>
    readonly onOpenChange: (open: boolean) => void
    readonly open: boolean
    readonly pendingLabel?: string
    readonly title: ReactNode
}

export interface PreventableEvent {
    readonly preventDefault: () => void
}

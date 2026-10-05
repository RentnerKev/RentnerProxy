import type { ReactNode } from 'react'

export type ModalSize = 'sm' | 'md' | 'lg'

export interface ModalProps {
    readonly children?: ReactNode
    readonly closeDisabled?: boolean
    readonly description: ReactNode
    readonly footer?: ReactNode
    readonly onOpenAutoFocus?: ((event: PreventableEvent) => void) | undefined
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
    readonly target?: EventTarget | null
}

export interface UseConfirmDialogLogicParams {
    readonly isPending: boolean
    readonly onConfirm: () => void | Promise<void>
}
export interface ConfirmDialogLogicResult {
    readonly handler: { readonly handleConfirm: () => void }
}
export interface UseModalLogicParams {
    readonly closeDisabled: boolean
    readonly onOpenAutoFocus?: ((event: PreventableEvent) => void) | undefined
    readonly onOpenChange: (open: boolean) => void
}
export interface ModalLogicResult {
    readonly handler: {
        readonly handleCloseAutoFocus: (event: PreventableEvent) => void
        readonly handleOpenAutoFocus: (event: PreventableEvent) => void
        readonly handleOpenChange: (nextOpen: boolean) => void
        readonly preventClose: (event: PreventableEvent) => void
    }
}

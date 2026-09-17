export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
    readonly id: string
    readonly label: string
    readonly href?: string
    readonly onSelect?: () => void | Promise<void>
}

export interface ToastOptions {
    readonly title?: string
    readonly duration?: number
    readonly detail?: string
    readonly context?: string
    readonly actions?: readonly ToastAction[]
    readonly persistent?: boolean
    readonly dismissible?: boolean
    readonly activity?: 'none' | 'running'
    readonly onDismiss?: () => void
}

export interface ToastMessage {
    readonly id: string
    readonly revision: number
    readonly kind: 'notification' | 'task'
    readonly message: string
    readonly title: string
    readonly tone: ToastTone
    readonly duration: number
    readonly open: boolean
    readonly detail?: string
    readonly context?: string
    readonly actions: readonly ToastAction[]
    readonly persistent: boolean
    readonly dismissible: boolean
    readonly activity: 'none' | 'running'
    readonly onDismiss?: () => void
}

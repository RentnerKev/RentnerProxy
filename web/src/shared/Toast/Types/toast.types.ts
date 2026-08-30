export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastOptions {
    readonly title?: string
    readonly duration?: number
}

export interface ToastMessage {
    readonly id: string
    readonly message: string
    readonly title: string
    readonly tone: ToastTone
    readonly duration: number
    readonly open: boolean
}

export interface FieldErrorProps {
    readonly errors: readonly unknown[]
    readonly id: string
    readonly feedback?: 'inline' | 'toast'
}

export interface FormMessageProps {
    readonly children: string
    readonly tone: 'error' | 'info' | 'success'
}

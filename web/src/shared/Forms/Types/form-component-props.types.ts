export interface FieldErrorProps {
    readonly errors: readonly unknown[]
    readonly id: string
}

export interface FormMessageProps {
    readonly children: string
    readonly tone: 'error' | 'info' | 'success'
}

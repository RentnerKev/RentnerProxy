export interface FieldErrorProps {
    readonly errors: readonly unknown[]
    readonly id: string
    readonly feedback?: 'inline' | 'toast'
    readonly validationEpoch?: number | undefined
}

export interface FormMessageProps {
    readonly children: string
    readonly tone: 'error' | 'info' | 'success'
}

import type { ReactNode } from 'react'

export interface DomainInputRowProps {
    readonly inputId: string
    readonly errorId: string
    readonly label: string
    readonly name: string
    readonly value: string
    readonly placeholder: string
    readonly describedBy: string
    readonly errors: readonly unknown[]
    readonly showInlineErrors?: boolean
    readonly disabled: boolean
    readonly readOnly?: boolean
    readonly removeDisabled: boolean
    readonly removeLabel: string
    readonly onBlur: () => void
    readonly onValueChange: (value: string) => void
    readonly onRemove: () => void
}

export interface DomainListFieldsetProps {
    readonly children: ReactNode
    readonly legend: string
    readonly addLabel: string
    readonly addDisabled: boolean
    readonly readOnly?: boolean
    readonly onAdd: () => void
    readonly hint: string
    readonly hintId: string
    readonly errorId: string
    readonly errors: readonly unknown[]
    readonly showInlineErrors?: boolean
}

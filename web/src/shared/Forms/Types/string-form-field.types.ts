import type { InputHTMLAttributes, ReactNode } from 'react'

interface StringFormFieldBinding {
    readonly name: string
    readonly state: {
        readonly value: string
        readonly meta: { readonly errors: ReadonlyArray<unknown> }
    }
    readonly handleBlur: () => void
    readonly handleChange: (value: string) => void
}

export interface StringFormFieldProps {
    readonly field: StringFormFieldBinding
    readonly label: ReactNode
    readonly placeholder: string
    readonly kind?: 'text' | 'email' | 'password'
    readonly autoComplete?: InputHTMLAttributes<HTMLInputElement>['autoComplete']
    readonly maxLength: number
    readonly showPasswordStrength?: boolean
    readonly labelAction?: ReactNode
}

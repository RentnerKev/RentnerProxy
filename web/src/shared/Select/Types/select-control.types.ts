export interface SelectControlOption {
    readonly disabled?: boolean | undefined
    readonly imageSrc?: string | undefined
    readonly label: string
    readonly value: string
}

export interface SelectControlProps {
    readonly id?: string | undefined
    readonly name?: string | undefined
    readonly required?: boolean | undefined
    readonly invalid?: boolean | undefined
    readonly describedBy?: string | undefined
    readonly onBlur?: (() => void) | undefined
    readonly disabled?: boolean | undefined
    readonly ariaLabel: string
    readonly className?: string | undefined
    readonly onValueChange: (value: string) => void
    readonly options: ReadonlyArray<SelectControlOption>
    readonly placeholder?: string | undefined
    readonly value: string
}

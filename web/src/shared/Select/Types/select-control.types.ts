export interface SelectControlOption {
    readonly label: string
    readonly value: string
}

export interface SelectControlProps {
    readonly ariaLabel: string
    readonly className?: string | undefined
    readonly onValueChange: (value: string) => void
    readonly options: ReadonlyArray<SelectControlOption>
    readonly placeholder?: string | undefined
    readonly value: string
}

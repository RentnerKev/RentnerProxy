export interface SelectControlOption {
    readonly imageSrc?: string | undefined
    readonly label: string
    readonly value: string
}

export interface SelectControlProps {
    readonly disabled?: boolean | undefined
    readonly ariaLabel: string
    readonly className?: string | undefined
    readonly onValueChange: (value: string) => void
    readonly options: ReadonlyArray<SelectControlOption>
    readonly placeholder?: string | undefined
    readonly value: string
}

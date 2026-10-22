import type { CheckboxInputProps } from '@rentnerkev/inputs'

export interface OptionToggleProps extends Pick<
    CheckboxInputProps,
    'name' | 'disabled' | 'onChange' | 'onBlur' | 'aria-label'
> {
    readonly label: string
    readonly checked: boolean
}

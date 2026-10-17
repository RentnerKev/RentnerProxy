import type { CheckboxInputProps } from '@rentnerkev/inputs'

export interface OptionToggleProps extends Pick<
    CheckboxInputProps,
    'name' | 'disabled' | 'onChange' | 'onBlur'
> {
    readonly label: string
    readonly checked: boolean
}

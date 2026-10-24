import { EmailInput, PasswordInput, TextInput } from '@rentnerkev/inputs'

import FieldError from './FieldError.tsx'
import type { StringFormFieldProps } from './Types/string-form-field.types.ts'

export default function StringFormField({
    field,
    label,
    placeholder,
    kind = 'text',
    autoComplete,
    maxLength,
    showPasswordStrength = false,
    labelAction,
}: StringFormFieldProps) {
    const inputProps = {
        id: field.name,
        name: field.name,
        autoComplete,
        placeholder,
        maxLength,
        value: field.state.value,
        onBlur: field.handleBlur,
        onValueChange: field.handleChange,
        'aria-describedby': `${field.name}-error`,
        'aria-invalid': field.state.meta.errors.length > 0,
    }
    const fieldLabel = (
        <label className="text-[0.82rem] font-[750] text-ink-soft" htmlFor={field.name}>
            {label}
        </label>
    )

    return (
        <div className="grid gap-[0.45rem]">
            {labelAction ? (
                <div className="flex items-center justify-between gap-4 text-[0.82rem] font-[750] text-ink-soft [&_a]:text-[0.76rem]">
                    {fieldLabel}
                    {labelAction}
                </div>
            ) : (
                fieldLabel
            )}
            {kind === 'password' ? (
                <PasswordInput {...inputProps} showPasswordStrength={showPasswordStrength} />
            ) : kind === 'email' ? (
                <EmailInput {...inputProps} type="email" inputMode="email" />
            ) : (
                <TextInput {...inputProps} />
            )}
            <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
        </div>
    )
}

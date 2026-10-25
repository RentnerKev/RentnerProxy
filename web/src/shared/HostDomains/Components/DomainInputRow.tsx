import { TextInput } from '@rentnerkev/inputs'
import { Trash2 } from 'lucide-react'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { DomainInputRowProps } from '../Types/domain-input.types.ts'

export default function DomainInputRow({
    inputId,
    errorId,
    label,
    name,
    value,
    placeholder,
    describedBy,
    errors,
    showInlineErrors = true,
    disabled,
    readOnly = false,
    removeDisabled,
    removeLabel,
    onBlur,
    onValueChange,
    onRemove,
}: DomainInputRowProps) {
    return (
        <div className="grid gap-[0.45rem]">
            <label className="sr-only" htmlFor={inputId}>
                {label}
            </label>
            <div className="flex items-start gap-2">
                <TextInput
                    id={inputId}
                    name={name}
                    value={value}
                    maxLength={1_024}
                    disabled={disabled}
                    readOnly={readOnly}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={placeholder}
                    onBlur={onBlur}
                    onValueChange={onValueChange}
                    aria-invalid={errors.length > 0}
                    aria-describedby={describedBy}
                />
                {!readOnly ? (
                    <button
                        type="button"
                        className={buttonClassName('ghost', 'mt-1 shrink-0 px-2')}
                        aria-label={removeLabel}
                        disabled={removeDisabled}
                        onClick={onRemove}
                    >
                        <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                ) : null}
            </div>
            {showInlineErrors ? <FieldError id={errorId} errors={errors} /> : null}
        </div>
    )
}

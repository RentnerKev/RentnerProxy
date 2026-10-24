import { CheckboxInput } from '@rentnerkev/inputs'
import { Check } from 'lucide-react'
import type { OptionToggleProps } from './Types/option-toggle.types.ts'

export default function OptionToggle({ label, iconOnly = false, ...input }: OptionToggleProps) {
    return (
        <label className="relative inline-flex w-fit max-w-full">
            <CheckboxInput
                {...input}
                aria-label={iconOnly ? label : undefined}
                className="peer sr-only"
            />
            <span
                className={`inline-flex cursor-pointer items-center rounded-lg border border-border-strong bg-surface-raised text-sm font-bold text-muted transition-colors peer-checked:border-accent-border peer-checked:bg-accent-muted peer-checked:text-accent-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50 ${iconOnly ? 'size-9 shrink-0 justify-center' : 'min-h-9 gap-2 px-3 py-2'}`}
            >
                <Check
                    aria-hidden="true"
                    className={`size-3.5 shrink-0 ${input.checked ? '' : 'opacity-25'}`}
                />
                {iconOnly ? null : label}
            </span>
        </label>
    )
}

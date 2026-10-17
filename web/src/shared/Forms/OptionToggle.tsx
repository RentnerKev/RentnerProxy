import { CheckboxInput } from '@rentnerkev/inputs'
import { Check } from 'lucide-react'
import type { OptionToggleProps } from './Types/option-toggle.types.ts'

export default function OptionToggle({ label, ...input }: OptionToggleProps) {
    return (
        <label className="inline-flex w-fit max-w-full">
            <CheckboxInput {...input} className="peer sr-only" />
            <span className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-surface-raised px-3 py-2 text-sm font-bold text-muted transition-colors peer-checked:border-accent-border peer-checked:bg-accent-soft peer-checked:text-accent-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                <Check
                    aria-hidden="true"
                    className={`size-3.5 shrink-0 ${input.checked ? '' : 'opacity-25'}`}
                />
                {label}
            </span>
        </label>
    )
}

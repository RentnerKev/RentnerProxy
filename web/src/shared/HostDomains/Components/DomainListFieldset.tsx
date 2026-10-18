import { Plus } from 'lucide-react'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import FieldError from '@/shared/Forms/FieldError.tsx'
import type { DomainListFieldsetProps } from '../Types/domain-input.types.ts'

export default function DomainListFieldset({
    children,
    legend,
    addLabel,
    addDisabled,
    onAdd,
    hint,
    hintId,
    errorId,
    errors,
}: DomainListFieldsetProps) {
    return (
        <fieldset className="m-0 min-w-0 border-0 p-0 [&_legend]:mb-[0.55rem] [&_legend]:text-[0.82rem] [&_legend]:font-[750] [&_legend]:text-ink-soft shell:col-span-full">
            <legend>{legend}</legend>
            <div className="grid gap-3">{children}</div>
            <button
                type="button"
                className={buttonClassName('secondary', 'mt-3 text-sm')}
                disabled={addDisabled}
                onClick={onAdd}
            >
                <Plus aria-hidden="true" className="size-4" />
                {addLabel}
            </button>
            <p id={hintId} className="m-0 text-[0.76rem] leading-[1.45] text-muted mt-2">
                {hint}
            </p>
            <FieldError id={errorId} errors={errors} />
        </fieldset>
    )
}

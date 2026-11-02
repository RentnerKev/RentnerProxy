import useFieldErrorLogic from './Hooks/useFieldErrorLogic.ts'
import type { FieldErrorProps } from './Types/form-component-props.types.ts'

export default function FieldError({
    errors,
    id,
    feedback = 'inline',
    validationEpoch,
}: FieldErrorProps) {
    const { state } = useFieldErrorLogic({ errors, id, feedback, validationEpoch })

    if (!state.message) {
        return null
    }

    if (feedback === 'toast') {
        return (
            <span id={id} className="sr-only">
                {state.message}
            </span>
        )
    }

    return (
        <p id={id} role="alert" className="m-0 text-[0.76rem] leading-[1.45] text-danger-text">
            {state.message}
        </p>
    )
}

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import getFieldErrorMessage from '@/lib/Forms/fieldErrors.ts'
import type { FieldErrorProps } from './Types/form-component-props.types.ts'

export default function FieldError({ errors, id }: FieldErrorProps) {
    const { authenticated, t } = useTranslationStore()
    const message = getFieldErrorMessage(errors, authenticated ? t : undefined)

    if (!message) {
        return null
    }

    return (
        <p id={id} className="m-0 text-[0.76rem] leading-[1.45] text-muted text-danger-text">
            {message}
        </p>
    )
}

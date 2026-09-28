import useTranslationStore from '../../language/useTranslationStore'
import getFieldErrorMessage from './Helpers/getFieldErrorMessage'
import type { FieldErrorProps } from './Types/form-component-props.types'

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

import useTranslationStore from '../../language/useTranslationStore'
import { uiClassNames } from '../Styles/uiClassNames'
import getFieldErrorMessage from './Helpers/getFieldErrorMessage'
import type { FieldErrorProps } from './Types/form-component-props.types'

export default function FieldError({ errors, id }: FieldErrorProps) {
    const { authenticated, t } = useTranslationStore()
    const message = getFieldErrorMessage(errors, authenticated ? t : undefined)

    if (!message) {
        return null
    }

    return (
        <p id={id} className={`${uiClassNames.form.hint} text-danger-text`}>
            {message}
        </p>
    )
}

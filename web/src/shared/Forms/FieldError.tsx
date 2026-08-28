import { uiClassNames } from '../Styles/uiClassNames'

interface FieldErrorProps {
    readonly errors: readonly unknown[]
    readonly id: string
}

export default function FieldError({ errors, id }: FieldErrorProps) {
    const message = errors
        .map((error) => {
            if (typeof error === 'string') {
                return error
            }

            if (
                typeof error === 'object' &&
                error !== null &&
                'message' in error &&
                typeof error.message === 'string'
            ) {
                return error.message
            }

            return null
        })
        .find((error): error is string => error !== null)

    if (!message) {
        return null
    }

    return (
        <p id={id} className={`${uiClassNames.form.hint} text-danger-text`}>
            {message}
        </p>
    )
}

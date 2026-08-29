export default function getFieldErrorMessage(errors: readonly unknown[]): string | null {
    return (
        errors
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
            .find((error): error is string => error !== null) ?? null
    )
}

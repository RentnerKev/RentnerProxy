export interface QueryFieldFeedbackProps {
    readonly isLoading: boolean
    readonly isError: boolean
    readonly isPending: boolean
    readonly onRetry: () => void
}

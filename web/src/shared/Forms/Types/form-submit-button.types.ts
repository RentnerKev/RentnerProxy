export interface FormSubmitButtonProps {
    readonly formId?: string
    readonly canSubmit: boolean
    readonly isSubmitting: boolean
    readonly isPending: boolean
    readonly disabled?: boolean
    readonly submitLabel: string
    readonly submitDescriptionId?: string | undefined
    readonly pendingSubmitLabel: string
}

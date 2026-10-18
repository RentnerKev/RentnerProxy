export interface FormModalActionsProps {
    readonly formId: string
    readonly isPending: boolean
    readonly canSubmit: boolean
    readonly isSubmitting: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly pendingSubmitLabel: string
    readonly submitLabel: string
}

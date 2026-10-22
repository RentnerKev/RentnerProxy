export interface ProxyConfigEditorActionsProps {
    readonly isBlocked: boolean
    readonly canEdit: boolean
    readonly isBusy: boolean
    readonly hasData: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onReset: () => void
    readonly onSave: () => void
}

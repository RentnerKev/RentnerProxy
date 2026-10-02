export interface ReauthenticationModalProps {
    readonly open: boolean
    readonly isPending: boolean
    readonly value: string
    readonly onChange: (value: string) => void
    readonly onConfirm: () => void
    readonly onPasskey: () => void
    readonly onOpenChange: (open: boolean) => void
    readonly onClose: () => void
}

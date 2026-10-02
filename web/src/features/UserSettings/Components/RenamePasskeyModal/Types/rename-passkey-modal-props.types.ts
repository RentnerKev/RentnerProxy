export interface RenamePasskeyModalProps {
    readonly initialName: string
    readonly isPending: boolean
    readonly mode: 'add' | 'rename'
    readonly open: boolean
    readonly onConfirm: (name: string) => void
    readonly onClose: () => void
}

export interface RecoveryCodesModalProps {
    readonly codes: ReadonlyArray<string> | null
    readonly onClose: () => void
}

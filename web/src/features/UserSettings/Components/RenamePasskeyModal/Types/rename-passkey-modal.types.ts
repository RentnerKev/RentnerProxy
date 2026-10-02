export interface RenamePasskeyModalLogicResult {
    state: { name: string; canSubmit: boolean }
    handler: {
        handleOpenChange: (open: boolean) => void
        setName: (value: string) => void
        confirm: () => void
    }
}

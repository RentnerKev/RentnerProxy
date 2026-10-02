export interface RecoveryCodesModalLogicResult {
    state: { copied: boolean }
    handler: { handleOpenChange: (open: boolean) => void; copy: () => Promise<void> }
}

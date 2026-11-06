export interface RecoveryCodesModalLogicResult {
    handler: { handleOpenChange: (open: boolean) => void; copy: () => Promise<void> }
}

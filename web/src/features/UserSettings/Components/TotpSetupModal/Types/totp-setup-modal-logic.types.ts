export type TotpSetupStep = 'scan' | 'verify'

export interface UseTotpSetupModalLogicOptions {
    readonly isPending: boolean
    readonly onClose: () => void
    readonly onConfirm: (code: string) => Promise<unknown>
}

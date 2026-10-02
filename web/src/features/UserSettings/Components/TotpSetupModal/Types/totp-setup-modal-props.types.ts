export interface TotpSetupModalProps {
    readonly setup: { challengeId: string; secret: string; otpAuthUrl: string } | null
    readonly isPending: boolean
    readonly onConfirm: (code: string) => Promise<unknown>
    readonly onClose: () => void
}

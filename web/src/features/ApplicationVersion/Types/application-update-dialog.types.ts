import type { ApplicationUpdateResult } from './application-update.types.ts'

export interface ApplicationUpdateDialogProps {
    readonly data: ApplicationUpdateResult | undefined
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
}

export interface ApplicationUpdateDialogLogicResult {
    readonly state: {
        readonly currentVersion: string
        readonly releaseUrl: string
        readonly canCopy: boolean
    }
    readonly handler: { readonly handleCopy: () => void }
}

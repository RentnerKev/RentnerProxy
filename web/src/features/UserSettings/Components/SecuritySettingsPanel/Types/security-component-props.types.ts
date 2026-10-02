import type { SecurityStatus } from '../../../Types/security.types.ts'

interface SecuritySectionStateProps {
    readonly status: SecurityStatus | undefined
    readonly isLoading: boolean
    readonly isPending: boolean
}

export interface TwoFactorSectionProps extends SecuritySectionStateProps {
    readonly onEnableTotp: () => void
    readonly onDisableTotp: () => void
    readonly onRegenerateCodes: () => void
}

export interface PasskeysSectionProps extends SecuritySectionStateProps {
    readonly onAddPasskey: () => void
    readonly onRenamePasskey: (id: string) => void
    readonly onRemovePasskey: (id: string) => void
}

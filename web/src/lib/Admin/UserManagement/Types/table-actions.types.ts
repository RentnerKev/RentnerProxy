import type { UserSummary } from '@/shared/Types/auth.types.ts'

export interface UserTableActionInputs {
    readonly actorIsOwner: boolean
    readonly canDisable: boolean
    readonly canEnable: boolean
    readonly canUpdate: boolean
    readonly currentUserId: string
    readonly enablingUserId: string | null
    readonly user: UserSummary
    readonly onDisable: (value: UserSummary) => void
    readonly onEnable: (value: UserSummary) => void
    readonly onEdit: (value: UserSummary) => void
}

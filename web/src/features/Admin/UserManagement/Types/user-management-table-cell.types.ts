import type { UserSummary } from '../../../../shared/Types/auth.types'

export interface UserCreatedAtCellProps {
    readonly value: unknown
}

export interface UserEmailCellProps {
    readonly value: string
}

export interface UserNameCellProps {
    readonly user: UserSummary
}

export interface UserRolesCellProps {
    readonly roleKeys: readonly string[]
}

export interface UserStatusCellProps {
    readonly value: string
}

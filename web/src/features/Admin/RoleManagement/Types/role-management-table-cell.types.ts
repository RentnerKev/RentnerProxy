export interface RoleCreatedAtCellProps {
    readonly value: unknown
}

export interface RoleDescriptionCellProps {
    readonly value: string
    readonly isSystem: boolean
    readonly roleKey: string
}

export interface RoleNameCellProps {
    readonly name: string
    readonly roleKey: string
    readonly isSystem: boolean
}

export interface RoleNumberCellProps {
    readonly value: number
}

export interface RoleTypeCellProps {
    readonly value: 'custom' | 'system'
}

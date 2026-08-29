export interface RoleCreatedAtCellProps {
    readonly value: unknown
}

export interface RoleDescriptionCellProps {
    readonly value: string
}

export interface RoleNameCellProps {
    readonly name: string
    readonly roleKey: string
}

export interface RoleNumberCellProps {
    readonly value: number
}

export interface RoleTypeCellProps {
    readonly value: 'custom' | 'system'
}

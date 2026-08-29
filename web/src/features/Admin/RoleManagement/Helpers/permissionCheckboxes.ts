import { PERMISSION_REGISTRY } from '../../../../config/permissions.config'
import type { PermissionKey } from '../../../../config/permissions.config'

export interface PermissionGroup {
    readonly label: string
    readonly prefix: string
    readonly permissions: ReadonlyArray<(typeof PERMISSION_REGISTRY)[number]>
}

const permissionGroupDefinitions = [
    { label: 'Application', prefix: 'app.' },
    { label: 'Users', prefix: 'users.' },
    { label: 'Roles', prefix: 'roles.' },
    { label: 'Account', prefix: 'account.' },
] as const

export function getAvailablePermissionGroups(
    availablePermissionKeys: readonly PermissionKey[],
): Array<PermissionGroup> {
    const availablePermissionSet = new Set(availablePermissionKeys)

    const groups: Array<PermissionGroup> = []

    for (const group of permissionGroupDefinitions) {
        const permissions = PERMISSION_REGISTRY.filter(
            (permission) =>
                permission.key.startsWith(group.prefix) &&
                availablePermissionSet.has(permission.key),
        )

        if (permissions.length > 0) {
            groups.push({ ...group, permissions })
        }
    }

    return groups
}

export function getPermissionCheckboxInputId(fieldName: string, permissionKey: string): string {
    return `${fieldName}-${permissionKey.replaceAll('.', '-')}`
}

export function getNextSelectedPermissionKeys(
    selectedPermissionKeys: readonly string[],
    permissionKey: string,
): Array<string> {
    return selectedPermissionKeys.includes(permissionKey)
        ? selectedPermissionKeys.filter((key) => key !== permissionKey)
        : [...selectedPermissionKeys, permissionKey]
}

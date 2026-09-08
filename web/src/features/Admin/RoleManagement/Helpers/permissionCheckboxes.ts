import { PERMISSION_REGISTRY } from '../../../../config/permissions.config'
import type { PermissionKey } from '../../../../config/permissions.config'

export interface PermissionGroup {
    readonly label: string
    readonly prefix: string
    readonly permissions: ReadonlyArray<(typeof PERMISSION_REGISTRY)[number]>
}

function getPermissionNamespace(permissionKey: string): string {
    const separatorIndex = permissionKey.indexOf('.')
    return separatorIndex === -1 ? permissionKey : permissionKey.slice(0, separatorIndex)
}

export function getAvailablePermissionGroups(
    availablePermissionKeys: readonly PermissionKey[],
): Array<PermissionGroup> {
    const availablePermissionSet = new Set(availablePermissionKeys)

    const groups = new Map<string, PermissionGroup>()

    for (const permission of PERMISSION_REGISTRY) {
        if (!availablePermissionSet.has(permission.key)) {
            continue
        }

        const namespace = getPermissionNamespace(permission.key)
        const existing = groups.get(namespace)
        groups.set(namespace, {
            label: `permissions.group.${namespace}`,
            prefix: `${namespace}.`,
            permissions: existing ? [...existing.permissions, permission] : [permission],
        })
    }

    return [...groups.values()]
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

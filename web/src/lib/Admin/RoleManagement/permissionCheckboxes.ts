import { PERMISSION_REGISTRY } from '@/config/permissions.config.ts'
import type { PermissionKey } from '@/shared/Types/permissions-config.types.ts'

import type { PermissionGroup } from './Types/permission-checkboxes.types.ts'
export type { PermissionGroup } from './Types/permission-checkboxes.types.ts'

function getPermissionGroup(permissionKey: string): { namespace: string; prefix: string } {
    const dotIndex = permissionKey.indexOf('.')
    const colonIndex = permissionKey.indexOf(':')
    const separatorIndex =
        dotIndex === -1 ? colonIndex : colonIndex === -1 ? dotIndex : Math.min(dotIndex, colonIndex)

    if (separatorIndex === -1) {
        return { namespace: permissionKey, prefix: `${permissionKey}.` }
    }

    const namespace = permissionKey.slice(0, separatorIndex)
    return {
        namespace,
        prefix: `${namespace}${permissionKey[separatorIndex]}`,
    }
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

        const { namespace, prefix } = getPermissionGroup(permission.key)
        const existing = groups.get(namespace)
        groups.set(namespace, {
            label: `permissions.group.${namespace}`,
            prefix,
            permissions: existing ? [...existing.permissions, permission] : [permission],
        })
    }

    return [...groups.values()]
}

export function getPermissionCheckboxInputId(fieldName: string, permissionKey: string): string {
    return `${fieldName}-${permissionKey.replace(/[.:]/gu, '-')}`
}

export function getNextSelectedPermissionKeys(
    selectedPermissionKeys: readonly string[],
    permissionKey: string,
): Array<string> {
    return selectedPermissionKeys.includes(permissionKey)
        ? selectedPermissionKeys.filter((key) => key !== permissionKey)
        : [...selectedPermissionKeys, permissionKey]
}

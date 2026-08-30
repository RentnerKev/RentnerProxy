import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { RoleManagementSummary } from '../../../../shared/Types/auth.types'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { RolesTableProps } from '../Types/role-management-component-props.types'
import useRolesTableColumns from './useRolesTableColumns'
import useTranslationStore from '../../../../language/useTranslationStore'
import type { Translate } from '../../../../language/useTranslationStore'
import { PERMISSION_REGISTRY, SYSTEM_ROLES } from '../../../../config/permissions.config'

const getRoleRowId = (role: RoleManagementSummary) => role.id

const systemRoleKeys = new Set<string>(Object.values(SYSTEM_ROLES))
const permissionKeys = new Set<string>(PERMISSION_REGISTRY.map((permission) => permission.key))

const getRoleName = (role: RoleManagementSummary, t: Translate) =>
    role.isSystem && systemRoleKeys.has(role.key) ? t(`systemRoles.${role.key}.name`) : role.name

const getRoleDescription = (role: RoleManagementSummary, t: Translate) =>
    role.isSystem && systemRoleKeys.has(role.key)
        ? t(`systemRoles.${role.key}.description`)
        : role.description

const getPermissionName = (permissionKey: string, t: Translate) =>
    permissionKeys.has(permissionKey) ? t(`permissions.${permissionKey}`) : permissionKey

const createRoleGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, RoleManagementSummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        const role = row.original

        if (!search) {
            return true
        }

        return [
            role.name,
            getRoleName(role, t),
            role.key,
            role.description,
            getRoleDescription(role, t),
            role.isSystem ? 'system' : 'custom',
            t(`admin.roles.type.${role.isSystem ? 'system' : 'custom'}`),
            ...role.permissionKeys.flatMap((permissionKey) => [
                permissionKey,
                getPermissionName(permissionKey, t),
            ]),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

const getColumnFilterConfigs = (t: Translate) =>
    ({
        name: {
            type: 'text' as const,
            placeholder: t('admin.roles.filters.nameOrKey'),
            maxLength: 100,
        },
        description: {
            type: 'text' as const,
            placeholder: t('admin.roles.filters.descriptions'),
            maxLength: 200,
        },
        type: {
            type: 'select' as const,
            placeholder: t('admin.roles.filters.allTypes'),
            options: [
                { label: t('admin.roles.type.system'), value: 'system' },
                { label: t('admin.roles.type.custom'), value: 'custom' },
            ],
        },
        createdAt: {
            type: 'dateRange' as const,
            fromLabel: t('admin.roles.filters.createdFrom'),
            toLabel: t('admin.roles.filters.createdTo'),
        },
    }) satisfies TableColumnFilterConfigs

export default function useRolesTableLogic({ roles, ...actions }: RolesTableProps) {
    const { locale, t } = useTranslationStore()
    const columnFilterConfigs = getColumnFilterConfigs(t)
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useRolesTableColumns(actions)
    const tableLogic = useClientTableLogic({
        data: roles,
        columns,
        getRowId: getRoleRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => createRoleGlobalFilter(t, locale), [locale, t]),
    })

    return {
        state: {
            ...tableLogic.state,
            columnFilterConfigs,
            showColumnFilters,
        },
        handler: {
            ...tableLogic.handler,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}

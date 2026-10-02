import type { RolesTableLogicResult } from '../Types/table-logic.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { ClientTableFeatures } from '@/shared/Table/clientTable.ts'
import type { RoleManagementSummary } from '@/shared/Types/auth.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { RolesTableProps } from '../../../Types/role-management-component-props.types.ts'
import useRolesTableColumns from './useRolesTableColumns.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import { PERMISSION_REGISTRY, SYSTEM_ROLES } from '@/config/permissions.config.ts'

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
        },
    }) satisfies TableColumnFilterConfigs

export default function useRolesTableLogic({
    roles,
    ...actions
}: RolesTableProps): RolesTableLogicResult {
    const { locale, t } = useTranslationStore()
    const columnFilterConfigs = getColumnFilterConfigs(t)
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useRolesTableColumns(actions)
    const tableLogic = useClientTable({
        data: roles,
        columns,
        getRowId: getRoleRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => createRoleGlobalFilter(t, locale), [locale, t]),
    })

    return {
        table: tableLogic.table,
        state: {
            searchInput: tableLogic.state.searchInput,
            columnFilterConfigs,
            showColumnFilters,
        },
        handler: {
            handleSearchInputChange: tableLogic.handler.handleSearchInputChange,
            handleResetFilters: tableLogic.handler.handleResetFilters,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}

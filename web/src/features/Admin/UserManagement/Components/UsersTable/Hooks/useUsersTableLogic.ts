import type { UsersTableLogicResult } from '../Types/table-logic.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { UserSummary } from '@/lib/Auth/Types/auth.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { UsersTableProps } from '../../../Types/user-management-component-props.types.ts'
import useUsersTableColumns from './useUsersTableColumns.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { SYSTEM_ROLES } from '@/config/permissions.config.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'

const getUserRowId = (user: UserSummary) => user.id

const systemRoleKeys = new Set<string>(Object.values(SYSTEM_ROLES))

const getRoleLabel = (roleKey: string, t: Translate) =>
    systemRoleKeys.has(roleKey) ? t(`systemRoles.${roleKey}.name`) : roleKey

const createUserGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, UserSummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)

        if (!search) {
            return true
        }

        return [
            row.original.displayName,
            row.original.email,
            row.original.status,
            t(`admin.users.status.${row.original.status}`),
            ...row.original.roleKeys.flatMap((roleKey) => [roleKey, getRoleLabel(roleKey, t)]),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

const createRoleFilterOptions = (roleKeys: ReadonlyArray<string>, t: Translate, locale: string) =>
    [...new Set(roleKeys)]
        .map((value) => ({ value, label: getRoleLabel(value, t) }))
        .toSorted((left, right) => left.label.localeCompare(right.label, locale))

export default function useUsersTableLogic({
    users,
    ...actions
}: UsersTableProps): UsersTableLogicResult {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useUsersTableColumns(actions)
    const tableLogic = useClientTable({
        data: users,
        columns,
        getRowId: getUserRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => createUserGlobalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            displayName: {
                type: 'text',
                placeholder: t('admin.users.filters.names'),
                maxLength: 100,
            },
            email: { type: 'text', placeholder: t('admin.users.filters.email'), maxLength: 254 },
            status: {
                type: 'select',
                placeholder: t('admin.users.filters.allStatuses'),
                options: [
                    { label: t('admin.users.status.active'), value: 'active' },
                    { label: t('admin.users.status.pending'), value: 'pending' },
                    { label: t('admin.users.status.disabled'), value: 'disabled' },
                ],
            },
            roles: {
                type: 'select',
                placeholder: t('admin.users.filters.allRoles'),
                options: createRoleFilterOptions(
                    users.flatMap((user) => [...user.roleKeys]),
                    t,
                    locale,
                ),
            },
            createdAt: {
                type: 'dateRange',
            },
        }),
        [locale, users, t],
    )

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

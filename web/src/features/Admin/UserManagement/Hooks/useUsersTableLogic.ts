import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { UserSummary } from '../../../../shared/Types/auth.types'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { UsersTableProps } from '../Types/user-management-component-props.types'
import useUsersTableColumns from './useUsersTableColumns'
import useTranslationStore from '../../../../language/useTranslationStore'
import { SYSTEM_ROLES } from '../../../../config/permissions.config'
import type { Translate } from '../../../../language/useTranslationStore'

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

export default function useUsersTableLogic({ users, ...actions }: UsersTableProps) {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useUsersTableColumns(actions)
    const tableLogic = useClientTableLogic({
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
                fromLabel: t('admin.users.filters.createdFrom'),
                toLabel: t('admin.users.filters.createdTo'),
            },
        }),
        [locale, users, t],
    )

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

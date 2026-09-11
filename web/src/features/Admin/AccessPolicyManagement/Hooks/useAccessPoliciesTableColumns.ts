import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'

import useTranslationStore from '../../../../language/useTranslationStore'
import {
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '../../../../shared/Table/Helpers/tableFilters'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'
import AccessPolicyTableActions from '../Components/AccessPolicyTableActions'
import {
    AccessPolicyAssignedCountCell,
    AccessPolicyCombinationCell,
    AccessPolicyCreatedAtCell,
    AccessPolicyModeCell,
    AccessPolicyNameCell,
} from '../Components/AccessPolicyTableCells'
import type { AccessPolicyTableActionProps } from '../Types/access-policy-table.types'

const textFilter = createTrimmedIncludesStringFilter<AccessPolicySummary>()
const dateFilter = createDateRangeFilter<AccessPolicySummary>()

export default function useAccessPoliciesTableColumns(actions: AccessPolicyTableActionProps) {
    const { t } = useTranslationStore()

    return useMemo<Array<ColumnDef<ClientTableFeatures, AccessPolicySummary>>>(
        () => [
            {
                id: 'name',
                accessorKey: 'name',
                header: t('admin.accessPolicies.columns.name'),
                sortFn: 'text',
                filterFn: textFilter,
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(AccessPolicyNameCell, { name: row.original.name }),
            },
            {
                id: 'mode',
                accessorKey: 'mode',
                header: t('admin.accessPolicies.columns.mode'),
                sortFn: 'text',
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) => createElement(AccessPolicyModeCell, { mode: row.original.mode }),
            },
            {
                id: 'combination',
                accessorKey: 'combination',
                header: t('admin.accessPolicies.columns.combination'),
                enableSorting: false,
                filterFn: filterFn_equalsString,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(AccessPolicyCombinationCell, {
                        combination: row.original.combination,
                    }),
            },
            {
                id: 'assignedHostCount',
                accessorKey: 'assignedHostCount',
                header: t('admin.accessPolicies.columns.assigned'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(AccessPolicyAssignedCountCell, {
                        value: row.original.assignedHostCount,
                    }),
            },
            {
                accessorKey: 'createdAt',
                header: t('admin.accessPolicies.columns.created'),
                sortFn: sortFn_datetime,
                filterFn: dateFilter,
                enableGlobalFilter: false,
                cell: ({ getValue }) =>
                    createElement(AccessPolicyCreatedAtCell, { value: getValue() }),
            },
            {
                id: 'actions',
                header: t('admin.accessPolicies.columns.actions'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(AccessPolicyTableActions, {
                        ...actions,
                        policy: row.original,
                    }),
            },
        ],
        [actions, t],
    )
}

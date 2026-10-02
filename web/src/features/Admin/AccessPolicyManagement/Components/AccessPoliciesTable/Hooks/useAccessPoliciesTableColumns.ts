import { filterFn_equalsString, sortFn_datetime } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { createElement, useMemo } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    createDateRangeFilter,
    createTrimmedIncludesStringFilter,
} from '@/lib/Table/tableFilters.ts'
import type { ClientTableFeatures } from '@/shared/Table/clientTable.ts'
import type { AccessPolicySummary } from '@/shared/Types/access-policies.types.ts'
import AccessPolicyTableActions from '../Components/AccessPolicyTableActions.tsx'
import {
    AccessPolicyBasicAuthCell,
    AccessPolicyAssignedCountCell,
    AccessPolicyCombinationCell,
    AccessPolicyCreatedAtCell,
    AccessPolicyIpRulesCell,
    AccessPolicyModeCell,
    AccessPolicyNameCell,
} from '../Components/AccessPolicyTableCells.tsx'
import { getBasicAuthAccountCount } from '@/lib/Admin/AccessPolicyManagement/basicAuthPolicyState.ts'
import type { AccessPolicyTableActionProps } from '../../../Types/access-policy-table.types.ts'

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
                id: 'basicAuth',
                accessorFn: (policy) => getBasicAuthAccountCount(policy),
                header: t('admin.accessPolicies.columns.basicAuth'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: false,
                cell: ({ row }) =>
                    createElement(AccessPolicyBasicAuthCell, {
                        combination: row.original.combination,
                        count: getBasicAuthAccountCount(row.original),
                        ipRules: row.original.ipRules,
                        mode: row.original.mode,
                    }),
            },
            {
                id: 'ipRules',
                accessorFn: (policy) =>
                    policy.ipRules
                        ? `${policy.ipRules.defaultAction} ${policy.ipRules.allow.join(' ')} ${policy.ipRules.deny.join(' ')}`
                        : '',
                header: t('admin.accessPolicies.columns.ipRules'),
                enableSorting: false,
                enableColumnFilter: false,
                enableGlobalFilter: true,
                cell: ({ row }) =>
                    createElement(AccessPolicyIpRulesCell, {
                        basicAuthAccountCount: getBasicAuthAccountCount(row.original),
                        combination: row.original.combination,
                        ipRules: row.original.ipRules,
                        mode: row.original.mode,
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

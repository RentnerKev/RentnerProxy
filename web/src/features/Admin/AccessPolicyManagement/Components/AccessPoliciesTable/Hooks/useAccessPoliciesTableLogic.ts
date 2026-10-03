import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { AccessPoliciesTableLogicResult } from '../Types/table-logic.types.ts'
import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import type { Translate } from '@/shared/Language/Types/language.types.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import type { AccessPolicySummary } from '@/lib/AccessPolicies/Types/access-policies.types.ts'
import type { AccessPoliciesTableProps } from '../../../Types/access-policy-table.types.ts'
import { getBasicAuthAccountCount } from '@/lib/Admin/AccessPolicyManagement/basicAuthPolicyState.ts'
import useAccessPoliciesTableColumns from './useAccessPoliciesTableColumns.ts'

const EMPTY_ACCESS_POLICIES: AccessPolicySummary[] = []
const getAccessPolicyRowId = (policy: AccessPolicySummary) => policy.id

const createAccessPolicyGlobalFilter =
    (t: Translate, locale: string): FilterFn<ClientTableFeatures, AccessPolicySummary> =>
    (row, _columnId, filterValue) => {
        const search = String(filterValue).trim().toLocaleLowerCase(locale)
        if (!search) return true
        const policy = row.original
        return [
            policy.name,
            policy.mode,
            t(`admin.accessPolicies.mode.${policy.mode}`),
            policy.combination ?? '',
            policy.combination ? t(`admin.accessPolicies.combination.${policy.combination}`) : '',
            String(policy.assignedHostCount),
            String(getBasicAuthAccountCount(policy)),
            policy.ipRules?.defaultAction ?? '',
            ...(policy.ipRules?.allow ?? []),
            ...(policy.ipRules?.deny ?? []),
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

export default function useAccessPoliciesTableLogic(
    props: AccessPoliciesTableProps,
): AccessPoliciesTableLogicResult {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useAccessPoliciesTableColumns(props)
    const data = useMemo(
        () => (props.policies.length > 0 ? [...props.policies] : EMPTY_ACCESS_POLICIES),
        [props.policies],
    )
    const tableLogic = useClientTable({
        data,
        columns,
        getRowId: getAccessPolicyRowId,
        initialSorting: [{ id: 'createdAt', desc: true }],
        globalFilterFn: useMemo(() => createAccessPolicyGlobalFilter(t, locale), [locale, t]),
    })
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            name: {
                type: 'text',
                placeholder: t('admin.accessPolicies.filters.name'),
                maxLength: 120,
            },
            mode: {
                type: 'select',
                placeholder: t('admin.accessPolicies.filters.allModes'),
                options: ['public', 'authenticated', 'ip-restricted', 'combined'].map((mode) => ({
                    label: t(`admin.accessPolicies.mode.${mode}`),
                    value: mode,
                })),
            },
            createdAt: {
                type: 'dateRange',
            },
        }),
        [t],
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

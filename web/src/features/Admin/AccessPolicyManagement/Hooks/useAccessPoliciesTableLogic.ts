import type { FilterFn } from '@tanstack/react-table'
import { useMemo, useState } from 'react'

import useTranslationStore, { type Translate } from '../../../../language/useTranslationStore'
import useClientTableLogic from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { ClientTableFeatures } from '../../../../shared/Table/Hooks/useClientTableLogic'
import type { TableColumnFilterConfigs } from '../../../../shared/Table/Types/table.types'
import type { AccessPolicySummary } from '../../../../shared/Types/access-policies.types'
import type { AccessPoliciesTableProps } from '../Types/access-policy-table.types'
import useAccessPoliciesTableColumns from './useAccessPoliciesTableColumns'

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
        ].some((value) => value.toLocaleLowerCase(locale).includes(search))
    }

export default function useAccessPoliciesTableLogic(props: AccessPoliciesTableProps) {
    const { locale, t } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const columns = useAccessPoliciesTableColumns(props)
    const data = useMemo(
        () => (props.policies.length > 0 ? [...props.policies] : EMPTY_ACCESS_POLICIES),
        [props.policies],
    )
    const tableLogic = useClientTableLogic({
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
                fromLabel: t('admin.accessPolicies.filters.createdFrom'),
                toLabel: t('admin.accessPolicies.filters.createdTo'),
            },
        }),
        [t],
    )

    return {
        state: { ...tableLogic.state, columnFilterConfigs, showColumnFilters },
        handler: {
            ...tableLogic.handler,
            toggleColumnFilters: () => setShowColumnFilters((visible) => !visible),
        },
    }
}

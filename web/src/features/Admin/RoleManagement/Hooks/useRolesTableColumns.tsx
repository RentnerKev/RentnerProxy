import { useMemo } from 'react'
import {
    columnFilteringFeature,
    createColumnHelper,
    createFilteredRowModel,
    createSortedRowModel,
    filterFn_includesString,
    globalFilteringFeature,
    rowSortingFeature,
    sortFn_text,
    tableFeatures,
} from '@tanstack/react-table'

import type { RoleSummary } from '../../../../shared/Types/auth.types'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RolesTableProps } from '../Types/role-management-component-props.types'

export const roleTableFeatures = tableFeatures({
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    filterFns: { includesString: filterFn_includesString },
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: { text: sortFn_text },
})

const roleColumnHelper = createColumnHelper<typeof roleTableFeatures, RoleSummary>()
const roleBadgeClassName =
    'inline-flex rounded-full bg-neutral px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold text-muted capitalize'
type RoleTableActions = Omit<RolesTableProps, 'roles'>

export default function useRolesTableColumns(actions: RoleTableActions) {
    return useMemo(
        () =>
            roleColumnHelper.columns([
                roleColumnHelper.accessor('name', { header: 'Name', sortFn: 'text' }),
                roleColumnHelper.accessor('key', {
                    header: 'Key',
                    sortFn: 'text',
                    cell: (info) => (
                        <code className={uiClassNames.table.code}>{info.getValue()}</code>
                    ),
                }),
                roleColumnHelper.accessor('isSystem', {
                    header: 'Type',
                    cell: (info) => (
                        <span className={roleBadgeClassName}>
                            {info.getValue() ? 'System' : 'Custom'}
                        </span>
                    ),
                }),
                roleColumnHelper.accessor((role) => role.permissionKeys.length, {
                    id: 'permissions',
                    header: 'Permissions',
                    cell: (info) => `${info.getValue()} assigned`,
                }),
                roleColumnHelper.accessor('description', {
                    header: 'Description',
                    sortFn: 'text',
                    cell: (info) => info.getValue() || '—',
                }),
                roleColumnHelper.display({
                    id: 'actions',
                    header: 'Actions',
                    cell: (info) => {
                        const role = info.row.original

                        if (role.isSystem) {
                            return null
                        }

                        return (
                            <div className={uiClassNames.table.actions}>
                                {actions.canUpdate ? (
                                    <button
                                        type="button"
                                        className={`${uiClassNames.button.quiet} ${uiClassNames.table.compactAction}`}
                                        onClick={() => actions.onEdit(role)}
                                    >
                                        Edit
                                    </button>
                                ) : null}
                                {actions.canDelete ? (
                                    <button
                                        type="button"
                                        className={`${uiClassNames.button.danger} ${uiClassNames.table.compactAction}`}
                                        disabled={actions.isDeleting}
                                        onClick={() => actions.onDelete(role)}
                                    >
                                        Delete
                                    </button>
                                ) : null}
                            </div>
                        )
                    },
                }),
            ]),
        [actions],
    )
}

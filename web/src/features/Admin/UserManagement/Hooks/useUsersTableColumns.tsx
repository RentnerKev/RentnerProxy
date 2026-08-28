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

import type { UserSummary } from '../../../../shared/Types/auth.types'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { UsersTableProps } from '../Types/user-management-component-props.types'

export const userTableFeatures = tableFeatures({
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
    filterFns: { includesString: filterFn_includesString },
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: { text: sortFn_text },
})

const userColumnHelper = createColumnHelper<typeof userTableFeatures, UserSummary>()
const dateFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
const userStatusBadgeClassName =
    'inline-flex rounded-full bg-neutral px-[0.6rem] py-[0.3rem] text-[0.66rem] font-extrabold text-muted capitalize data-[status=active]:bg-success-bg data-[status=active]:text-success-text data-[status=disabled]:bg-danger-bg data-[status=disabled]:text-danger-text'

type UserTableActions = Omit<UsersTableProps, 'users'>

export default function useUsersTableColumns(actions: UserTableActions) {
    return useMemo(
        () =>
            userColumnHelper.columns([
                userColumnHelper.accessor('displayName', { header: 'Name', sortFn: 'text' }),
                userColumnHelper.accessor('email', { header: 'Email', sortFn: 'text' }),
                userColumnHelper.accessor('status', {
                    header: 'Status',
                    sortFn: 'text',
                    cell: (info) => (
                        <span className={userStatusBadgeClassName} data-status={info.getValue()}>
                            {info.getValue()}
                        </span>
                    ),
                }),
                userColumnHelper.accessor((user) => user.roleKeys.join(' '), {
                    id: 'roles',
                    header: 'Roles',
                    sortFn: 'text',
                    cell: (info) => (
                        <div className={uiClassNames.chip.row}>
                            {info.row.original.roleKeys.map((role) => (
                                <span className={uiClassNames.chip.item} key={role}>
                                    {role}
                                </span>
                            ))}
                        </div>
                    ),
                }),
                userColumnHelper.accessor('createdAt', {
                    header: 'Created',
                    cell: (info) => dateFormatter.format(new Date(info.getValue())),
                }),
                userColumnHelper.display({
                    id: 'actions',
                    header: 'Actions',
                    cell: (info) => {
                        const user = info.row.original

                        return (
                            <div className={uiClassNames.table.actions}>
                                {actions.canUpdate ? (
                                    <button
                                        type="button"
                                        className={`${uiClassNames.button.quiet} ${uiClassNames.table.compactAction}`}
                                        onClick={() => actions.onEdit(user)}
                                    >
                                        Edit
                                    </button>
                                ) : null}
                                {actions.canDisable && user.status !== 'disabled' ? (
                                    <button
                                        type="button"
                                        className={`${uiClassNames.button.danger} ${uiClassNames.table.compactAction}`}
                                        disabled={actions.isDisabling}
                                        onClick={() => actions.onDisable(user)}
                                    >
                                        Disable
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

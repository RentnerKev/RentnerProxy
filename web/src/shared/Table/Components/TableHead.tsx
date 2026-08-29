import type { RowData } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Fragment } from 'react'

import type { TableHeadProps } from '../Types/table.types'
import TableColumnFilters from './TableColumnFilters'

export default function TableHead<TData extends RowData>({
    table,
    showColumnFilters,
    columnFilterConfigs,
}: TableHeadProps<TData>) {
    return (
        <thead className="bg-surface-subtle font-mono text-[0.62rem] tracking-[0.07em] text-muted uppercase">
            <table.Subscribe
                selector={(state) => ({
                    sorting: state.sorting,
                    columnFilters: state.columnFilters,
                })}
            >
                {() =>
                    table.getHeaderGroups().map((headerGroup) => (
                        <Fragment key={headerGroup.id}>
                            <tr>
                                {headerGroup.headers.map((header) => {
                                    const canSort = header.column.getCanSort()
                                    const sortDirection = header.column.getIsSorted()
                                    const ariaSort = canSort
                                        ? sortDirection === 'asc'
                                            ? 'ascending'
                                            : sortDirection === 'desc'
                                              ? 'descending'
                                              : 'none'
                                        : undefined

                                    return (
                                        <th
                                            key={header.id}
                                            scope="col"
                                            aria-sort={ariaSort}
                                            className="border-b border-border px-4 py-[0.85rem] text-left align-middle font-bold"
                                        >
                                            {header.isPlaceholder ? null : canSort ? (
                                                <button
                                                    type="button"
                                                    onClick={header.column.getToggleSortingHandler()}
                                                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-left text-inherit outline-hidden transition-colors hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                                                    aria-label={`Sort by ${header.column.id}`}
                                                >
                                                    <table.FlexRender header={header} />
                                                    <span
                                                        aria-hidden="true"
                                                        className="text-brand-text"
                                                    >
                                                        {sortDirection === 'asc' ? (
                                                            <ArrowUp className="size-3.5" />
                                                        ) : sortDirection === 'desc' ? (
                                                            <ArrowDown className="size-3.5" />
                                                        ) : (
                                                            <ArrowUpDown className="size-3.5" />
                                                        )}
                                                    </span>
                                                </button>
                                            ) : (
                                                <table.FlexRender header={header} />
                                            )}
                                        </th>
                                    )
                                })}
                            </tr>
                            {showColumnFilters ? (
                                <TableColumnFilters
                                    headerGroup={headerGroup}
                                    filterConfigs={columnFilterConfigs}
                                />
                            ) : null}
                        </Fragment>
                    ))
                }
            </table.Subscribe>
        </thead>
    )
}

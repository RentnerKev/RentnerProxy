import { FlexRender } from '@tanstack/react-table'

import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useRolesTableLogic from '../Hooks/useRolesTableLogic'
import type { RolesTableProps } from '../Types/role-management-component-props.types'

export default function RolesTable(props: RolesTableProps) {
    const { roles } = props
    const { state, handler } = useRolesTableLogic(props)

    return (
        <section className={uiClassNames.table.panel} aria-labelledby="roles-table-title">
            <div className={uiClassNames.table.toolbar}>
                <div>
                    <p className={uiClassNames.themedTechnicalLabel}>Registry</p>
                    <h2 id="roles-table-title">{roles.length} roles</h2>
                </div>
                <label className={uiClassNames.table.searchLabel}>
                    <span>Search roles</span>
                    <input
                        className={uiClassNames.table.search}
                        type="search"
                        value={state.search}
                        onChange={(event) => handler.setSearch(event.target.value)}
                        placeholder="Name, key, description…"
                    />
                </label>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-[54rem] w-full border-collapse text-left">
                    <thead>
                        {state.table.getHeaderGroups().map((headerGroup) => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <th
                                        key={header.id}
                                        scope="col"
                                        className="border-b border-border bg-surface-subtle px-4 py-[0.85rem] align-middle font-mono text-[0.62rem] tracking-[0.07em] text-muted uppercase"
                                    >
                                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                                            <button
                                                type="button"
                                                className="inline-flex cursor-pointer items-center gap-[0.35rem] border-0 bg-transparent p-0 font-inherit tracking-inherit text-inherit uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                                                aria-label={`Sort by ${header.column.id}`}
                                                onClick={header.column.getToggleSortingHandler()}
                                            >
                                                <FlexRender header={header} />
                                                <span aria-hidden="true">
                                                    {header.column.getIsSorted() === 'asc'
                                                        ? '↑'
                                                        : header.column.getIsSorted() === 'desc'
                                                          ? '↓'
                                                          : '↕'}
                                                </span>
                                            </button>
                                        ) : (
                                            <FlexRender header={header} />
                                        )}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {state.table.getRowModel().rows.map((row) => (
                            <tr key={row.id} className="hover:bg-surface-hover">
                                {row.getAllCells().map((cell) => (
                                    <td
                                        key={cell.id}
                                        className="border-b border-border px-4 py-[0.85rem] align-middle text-[0.78rem] text-ink-soft"
                                    >
                                        <FlexRender cell={cell} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {state.table.getRowModel().rows.length === 0 ? (
                <div className={uiClassNames.table.empty}>No roles match this filter.</div>
            ) : null}
        </section>
    )
}

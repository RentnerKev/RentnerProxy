import type { RowData } from '@tanstack/react-table'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { TableColumnFiltersProps } from '../Types/table.types.ts'
import TableColumnFilterInput from './TableColumnFilterInput.tsx'

export default function TableColumnFilters<TData extends RowData>({
    table,
    filterConfigs,
    resetButton,
}: TableColumnFiltersProps<TData>) {
    const { t } = useTranslationStore()
    const headersByColumn = new Map(
        table
            .getFlatHeaders()
            .filter((header) => !header.isPlaceholder && header.subHeaders.length === 0)
            .map((header) => [header.column.id, header]),
    )

    return (
        <>
            {table
                .getAllLeafColumns()
                .filter((column) => column.getCanFilter())
                .map((column, index, columns) => {
                    const header = headersByColumn.get(column.id)
                    const config = filterConfigs[column.id] ?? {
                        type: 'text',
                        placeholder: t('table.filterColumnPlaceholder', {
                            column: String(column.columnDef.header ?? ''),
                        }),
                    }
                    const field = (
                        <div key={column.id} className="grid min-w-0 flex-1 content-start gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                {header ? (
                                    <table.FlexRender header={header} />
                                ) : typeof column.columnDef.header === 'string' ? (
                                    column.columnDef.header
                                ) : (
                                    column.id
                                )}
                            </span>
                            <table.Subscribe source={table.atoms.columnFilters}>
                                {() => <TableColumnFilterInput column={column} config={config} />}
                            </table.Subscribe>
                        </div>
                    )
                    if (index !== columns.length - 1) return field

                    const desktopSpan = ['xl:col-span-3', 'xl:col-span-2', 'xl:col-span-1'][
                        index % 3
                    ]
                    const fieldWidth = [
                        'xl:max-w-[calc((100%_-_2rem)/3)]',
                        'xl:max-w-[calc((100%_-_1rem)/2)]',
                        '',
                    ][index % 3]
                    return (
                        <div
                            key={column.id}
                            className={`flex min-w-0 items-end gap-4 ${index % 2 === 0 ? 'sm:col-span-2' : 'sm:col-span-1'} ${desktopSpan}`}
                        >
                            <div className={`min-w-0 flex-1 ${fieldWidth}`}>{field}</div>
                            {resetButton}
                        </div>
                    )
                })}
        </>
    )
}

import type { RowData } from '@tanstack/react-table'

import useTranslationStore from '../../../language/useTranslationStore'
import type { TableColumnFiltersProps } from '../Types/table.types'
import TableColumnFilterInput from './TableColumnFilterInput'

export default function TableColumnFilters<TData extends RowData>({
    table,
    filterConfigs,
    resetButton,
}: TableColumnFiltersProps<TData>) {
    const { t } = useTranslationStore()

    return (
        <>
            {table
                .getFlatHeaders()
                .filter(
                    (header) =>
                        !header.isPlaceholder &&
                        header.subHeaders.length === 0 &&
                        header.column.getCanFilter(),
                )
                .map((header, index, headers) => {
                    const config = filterConfigs[header.column.id] ?? {
                        type: 'text',
                        placeholder: t('table.filterColumnPlaceholder', {
                            column: String(header.column.columnDef.header ?? ''),
                        }),
                    }
                    const field = (
                        <div key={header.id} className="grid min-w-0 flex-1 content-start gap-1.5">
                            <span className="text-xs font-extrabold text-muted">
                                <table.FlexRender header={header} />
                            </span>
                            <table.Subscribe source={table.atoms.columnFilters}>
                                {() => (
                                    <TableColumnFilterInput
                                        column={header.column}
                                        config={config}
                                    />
                                )}
                            </table.Subscribe>
                        </div>
                    )
                    if (!resetButton || index !== headers.length - 1) return field

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
                            key={header.id}
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

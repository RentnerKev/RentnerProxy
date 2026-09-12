import type { RowData } from '@tanstack/react-table'

import useTranslationStore from '../../../language/useTranslationStore'
import type { TableColumnFiltersProps } from '../Types/table.types'
import TableColumnFilterInput from './TableColumnFilterInput'

export default function TableColumnFilters<TData extends RowData>({
    table,
    filterConfigs,
}: TableColumnFiltersProps<TData>) {
    const { t } = useTranslationStore()

    return (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {table
                .getFlatHeaders()
                .filter(
                    (header) =>
                        !header.isPlaceholder &&
                        header.subHeaders.length === 0 &&
                        header.column.getCanFilter(),
                )
                .map((header) => {
                    const config = filterConfigs[header.column.id] ?? {
                        type: 'text',
                        placeholder: t('table.filterColumnPlaceholder', {
                            column: String(header.column.columnDef.header ?? ''),
                        }),
                    }
                    return (
                        <div key={header.id} className="grid min-w-0 content-start gap-1.5">
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
                })}
        </div>
    )
}

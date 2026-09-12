import type { Column, ColumnDef, FilterFn, RowData, SortingState } from '@tanstack/react-table'
import type { ReactNode } from 'react'

import type { ClientTable, ClientTableFeatures } from '../clientTable'

export interface TableFilterOption {
    readonly label: string
    readonly value: string
}

export interface TableDateRangeFilterValue {
    from?: string
    to?: string
}

export type TableColumnFilterConfig =
    | {
          readonly type: 'text'
          readonly placeholder?: string
          readonly maxLength?: number
      }
    | {
          readonly type: 'select'
          readonly placeholder?: string
          readonly options: ReadonlyArray<TableFilterOption>
      }
    | {
          readonly type: 'dateRange'
          readonly fromLabel?: string
          readonly toLabel?: string
      }

export type TableColumnFilterConfigs = Readonly<Record<string, TableColumnFilterConfig>>

export interface TableBodyStateConfig {
    readonly title: ReactNode
    readonly description: ReactNode
    readonly action?: ReactNode
}

export interface TableBodyStateProps {
    readonly columnCount: number
    readonly state: TableBodyStateConfig
}

export interface TableLoadingBodyProps {
    readonly columnCount: number
    readonly loadingLabel: string
}

export interface UseClientTableLogicParams<TData extends RowData> {
    readonly data: Array<TData>
    readonly columns: Array<ColumnDef<ClientTableFeatures, TData>>
    readonly getRowId: (row: TData) => string
    readonly initialSorting?: SortingState
    readonly initialPageSize?: number
    readonly globalFilterFn?: FilterFn<ClientTableFeatures, TData>
}

export interface UseClientTableLogicReturn<TData extends RowData> {
    readonly state: {
        readonly table: ClientTable<TData>
        readonly searchInput: string
    }
    readonly handler: {
        readonly handleSearchInputChange: (value: string) => void
        readonly handleResetFilters: () => void
    }
}

export interface TableHeadProps<TData extends RowData> {
    readonly table: ClientTable<TData>
}

export interface TableColumnFiltersProps<TData extends RowData> {
    readonly table: ClientTable<TData>
    readonly filterConfigs: TableColumnFilterConfigs
}

export interface TableColumnFilterInputProps<TData extends RowData> {
    readonly column: Column<ClientTableFeatures, TData, unknown>
    readonly config: TableColumnFilterConfig
}

export interface TableBodyProps<TData extends RowData> {
    readonly table: ClientTable<TData>
    readonly isLoading: boolean
    readonly loadingLabel: string
    readonly emptyState: TableBodyStateConfig
    readonly filteredEmptyState: TableBodyStateConfig
}

export interface TablePaginationProps<TData extends RowData> {
    readonly table: ClientTable<TData>
    readonly itemLabel: string
    readonly pageSizeOptions: ReadonlyArray<number>
}

export interface TablePaginationControlsProps {
    readonly pageIndex: number
    readonly pageSize: number
    readonly total: number
    readonly pageSizeOptions: ReadonlyArray<number>
    readonly itemLabel: string
    readonly onPageChange: (pageIndex: number) => void
    readonly onPageSizeChange: (pageSize: number) => void
    readonly disabled?: boolean
}

export interface RemoteTablePaginationProps extends Omit<
    TablePaginationControlsProps,
    'pageSizeOptions'
> {
    readonly pageSizeOptions?: ReadonlyArray<number>
}

export interface DataTableProps<TData extends RowData> {
    readonly table: ClientTable<TData>
    readonly eyebrow: string
    readonly title: string
    readonly description?: string | undefined
    readonly searchInput: string
    readonly searchLabel: string
    readonly searchPlaceholder: string
    readonly showColumnFilters: boolean
    readonly enableColumnFilters?: boolean
    readonly onSearchChange: (value: string) => void
    readonly onToggleColumnFilters: () => void
    readonly onResetFilters: () => void
    readonly columnFilterConfigs?: TableColumnFilterConfigs
    readonly isLoading?: boolean
    readonly loadingLabel: string
    readonly emptyState: TableBodyStateConfig
    readonly filteredEmptyState: TableBodyStateConfig
    readonly itemLabel: string
    readonly pageSizeOptions?: ReadonlyArray<number>
    readonly action?: ReactNode
    readonly tableMinWidthClassName?: string
}

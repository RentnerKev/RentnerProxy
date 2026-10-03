import type { RowData, ReactTable } from '@tanstack/react-table'

import type { clientTableFeatures } from '../clientTable.ts'

export type ClientTableFeatures = typeof clientTableFeatures

export type ClientTable<TData extends RowData> = ReactTable<ClientTableFeatures, TData, null>

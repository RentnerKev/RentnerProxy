import { getNotificationDeliveryState } from '@/lib/Notifications/delivery-state.ts'
import { createElement, useMemo, useState } from 'react'
import {
    DeliveryChannelCell,
    DeliveryHealthCell,
    DeliveryStatusCell,
    DeliveryDateCell,
} from '../Components/DeliveryCells.tsx'
import type { ColumnDef } from '@tanstack/react-table'
import type { ClientTableFeatures } from '@/shared/Table/Types/client-table.types.ts'
import type { TableColumnFilterConfigs } from '@/shared/Table/Types/table.types.ts'
import useClientTable from '@/shared/Table/Hooks/useClientTable.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import type { DeliveryTableProps } from '../Types/notifications-panel.types.ts'

export default function useDeliveryTableLogic({ status, channels }: DeliveryTableProps) {
    const { t, locale } = useTranslationStore()
    const [showColumnFilters, setShowColumnFilters] = useState(false)
    const rows = useMemo(() => {
        const incidents = new Map(status.incidents.map((item) => [item.id, item]))
        const names = new Map(channels.map((item) => [item.id, item.name]))
        return status.deliveries.map((delivery) => ({
            ...delivery,
            channelName: names.get(delivery.channelId) ?? t('account.notifications.deletedChannel'),
            incidentState: getNotificationDeliveryState(
                delivery,
                incidents.get(delivery.incidentId),
            ),
        }))
    }, [status, channels, t])
    type Row = (typeof rows)[number]
    const columns = useMemo<Array<ColumnDef<ClientTableFeatures, Row>>>(
        () => [
            {
                id: 'channelName',
                accessorFn: (row) =>
                    [
                        row.channelName,
                        t(`account.notifications.categories.${row.category}`),
                        row.resourceId,
                    ].join(' '),
                header: t('account.notifications.name'),
                sortFn: 'text',
                filterFn: 'includesString',
                cell: ({ row }) => createElement(DeliveryChannelCell, { row: row.original }),
            },
            {
                id: 'type',
                accessorFn: (row) => t(`account.notifications.types.${row.type}`),
                header: t('account.notifications.deliveryType'),
                sortFn: 'text',
                filterFn: 'includesString',
            },
            {
                id: 'incidentState',
                accessorFn: (row) => t(`account.notifications.incidentStates.${row.incidentState}`),
                header: t('account.notifications.incident'),
                sortFn: 'text',
                filterFn: 'includesString',
                cell: ({ row }) => createElement(DeliveryHealthCell, { row: row.original }),
            },
            {
                id: 'status',
                accessorFn: (row) =>
                    [
                        t(`account.notifications.deliveryStates.${row.status}`),
                        row.error ? t(`account.notifications.errors.${row.error}`) : '',
                    ].join(' '),
                header: t('account.notifications.delivery'),
                sortFn: 'text',
                filterFn: 'includesString',
                cell: ({ row }) => createElement(DeliveryStatusCell, { row: row.original }),
            },
            {
                id: 'updatedAt',
                accessorKey: 'updatedAt',
                header: t('account.notifications.updatedAt'),
                sortFn: (left, right) => left.original.updatedAt - right.original.updatedAt,
                enableColumnFilter: false,
                cell: ({ row }) => createElement(DeliveryDateCell, { row: row.original, locale }),
            },
        ],
        [t, locale],
    )
    const columnFilterConfigs = useMemo<TableColumnFilterConfigs>(
        () => ({
            channelName: { type: 'text', placeholder: t('account.notifications.search') },
            type: {
                type: 'select',
                options: ['incident', 'recovery', 'success', 'test'].map((value) => ({
                    value: t(`account.notifications.types.${value}`),
                    label: t(`account.notifications.types.${value}`),
                })),
            },
            status: {
                type: 'select',
                options: ['pending', 'inflight', 'succeeded', 'failed', 'cancelled'].map(
                    (value) => ({
                        value: t(`account.notifications.deliveryStates.${value}`),
                        label: t(`account.notifications.deliveryStates.${value}`),
                    }),
                ),
            },
            incidentState: {
                type: 'select',
                options: [
                    'active',
                    'recovered',
                    'backup_succeeded',
                    'backup_failed',
                    'test',
                    'unknown',
                ].map((value) => ({
                    value: t(`account.notifications.incidentStates.${value}`),
                    label: t(`account.notifications.incidentStates.${value}`),
                })),
            },
        }),
        [t],
    )
    const { table, state, handler } = useClientTable({
        data: rows,
        columns,
        getRowId: (row) => row.id,
        initialSorting: [{ id: 'updatedAt', desc: true }],
    })
    return {
        table,
        state: { searchInput: state.searchInput, showColumnFilters, columnFilterConfigs },
        handler: {
            handleSearchChange: handler.handleSearchInputChange,
            handleResetFilters: handler.handleResetFilters,
            handleToggleFilters: () => setShowColumnFilters((value) => !value),
        },
    }
}

import DataTable from '@/shared/Table/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useDeliveryTableLogic from '../Hooks/useDeliveryTableLogic.ts'
import type { DeliveryTableProps } from '../Types/notifications-panel.types.ts'

export default function DeliveryTable(props: DeliveryTableProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useDeliveryTableLogic(props)
    return (
        <DataTable
            eyebrow={t('account.notifications.title')}
            table={table}
            title={t('account.notifications.deliveries')}
            description={t('account.notifications.deliveriesHint')}
            searchInput={state.searchInput}
            searchLabel={t('account.notifications.search')}
            searchPlaceholder={t('account.notifications.search')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchChange}
            onToggleColumnFilters={handler.handleToggleFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            loadingLabel={t('common.loading')}
            itemLabel={t('account.notifications.deliveries')}
            emptyState={{
                title: t('account.notifications.noDeliveries'),
                description: t('account.notifications.deliveriesHint'),
            }}
            filteredEmptyState={{
                title: t('account.notifications.noMatches'),
                description: t('account.notifications.search'),
            }}
            tableMinWidthClassName="min-w-0 table-fixed [&_th:nth-child(1)]:w-[27%] [&_th:nth-child(2)]:w-[13%] [&_th:nth-child(3)]:w-[18%] [&_th:nth-child(4)]:w-[25%] [&_th:nth-child(5)]:w-[17%] [&_th_button]:h-auto [&_th_button]:min-h-12 [&_th_button]:break-words [&_th]:px-3 [&_td]:px-3"
        />
    )
}

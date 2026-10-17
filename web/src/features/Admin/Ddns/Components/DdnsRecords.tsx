import { Plus } from 'lucide-react'
import DataTable from '@/shared/Table/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useDdnsRecordsLogic from '../Hooks/useDdnsRecordsLogic.ts'
import type { DdnsRecordsProps } from '../Types/ddns-table.types.ts'
export default function DdnsRecords(props: DdnsRecordsProps) {
    const { t } = useTranslationStore()
    const { table, state, handler } = useDdnsRecordsLogic(props)
    const action = props.canAdd ? (
        <button
            type="button"
            onClick={props.onAdd}
            disabled={props.locked}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-extrabold text-accent-foreground enabled:hover:bg-accent-hover disabled:opacity-50"
        >
            <Plus size={16} aria-hidden="true" />
            {t('admin.ddns.editor.addTitle')}
        </button>
    ) : undefined
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.ddns.table.eyebrow')}
            title={t('admin.ddns.table.title', { count: props.rows.length })}
            searchInput={state.searchInput}
            searchLabel={t('admin.ddns.table.search')}
            searchPlaceholder={t('admin.ddns.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            loadingLabel={t('common.loading')}
            emptyState={{
                title: t('admin.ddns.table.emptyTitle'),
                description: t('admin.ddns.table.emptyDescription'),
                action,
            }}
            filteredEmptyState={{
                title: t('admin.ddns.table.filteredTitle'),
                description: t('admin.ddns.table.filteredDescription'),
            }}
            itemLabel={t('admin.ddns.table.itemLabel')}
            action={action}
            tableMinWidthClassName="min-w-[68rem]"
        />
    )
}

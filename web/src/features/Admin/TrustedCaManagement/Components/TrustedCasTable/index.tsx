import DataTable from '@/shared/Table/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useTrustedCasTableLogic from './Hooks/useTrustedCasTableLogic.ts'
import type { TrustedCaTableProps } from './Types/trusted-cas-table.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function TrustedCasTable(props: TrustedCaTableProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useTrustedCasTableLogic(props)
    const createAction = props.canCreate ? (
        <button
            type="button"
            className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
            onClick={props.onCreate}
            disabled={props.isPending}
        >
            {t('admin.trustedCas.actions.import')}
        </button>
    ) : undefined
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.trustedCas.table.eyebrow')}
            title={
                props.loading
                    ? t('admin.trustedCas.table.loading')
                    : t('admin.trustedCas.table.count', { count: props.trustedCas.length })
            }
            description={t('admin.trustedCas.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.trustedCas.table.searchLabel')}
            searchPlaceholder={t('admin.trustedCas.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            isLoading={props.loading}
            loadingLabel={t('admin.trustedCas.table.loading')}
            emptyState={{
                title: t('admin.trustedCas.table.emptyTitle'),
                description: t('admin.trustedCas.table.emptyDescription'),
                action: createAction,
            }}
            filteredEmptyState={{
                title: t('admin.trustedCas.table.filteredEmptyTitle'),
                description: t('admin.trustedCas.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.trustedCas.table.itemLabel')}
            action={createAction}
            tableMinWidthClassName="min-w-[65rem]"
        />
    )
}

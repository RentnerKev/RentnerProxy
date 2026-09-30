import DataTable from '../../../../shared/Table'
import useTranslationStore from '../../../../language/useTranslationStore'
import useTrustedCasTableLogic from '../Hooks/useTrustedCasTableLogic'
import type { TrustedCaTableProps } from '../Types/trusted-ca-management.types'

export default function TrustedCasTable(props: TrustedCaTableProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useTrustedCasTableLogic(props)
    const createAction = props.canCreate ? (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
            onClick={props.onCreate}
            disabled={props.isPending}
        >
            {t('admin.trustedCas.actions.import')}
        </button>
    ) : undefined
    return (
        <DataTable
            table={state.table}
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

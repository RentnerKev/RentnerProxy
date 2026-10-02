import DataTable from '@/shared/Table/index.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import useCertificatesTableLogic from './Hooks/useCertificatesTableLogic.ts'
import type { CertificateTableProps } from './Types/certificates-table.types.ts'

export default function CertificatesTable(props: CertificateTableProps) {
    const { t } = useTranslationStore()
    const { state, handler, table } = useCertificatesTableLogic(props)
    const createAction = props.canCreate ? (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
            onClick={props.onCreate}
            disabled={props.isPending}
        >
            {t('admin.certificates.actions.import')}
        </button>
    ) : undefined
    const requestAction = props.canIssue ? (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
            onClick={props.onRequest}
            disabled={props.isPending}
        >
            {t('admin.certificates.actions.request')}
        </button>
    ) : undefined
    return (
        <DataTable
            table={table}
            eyebrow={t('admin.certificates.table.eyebrow')}
            title={
                props.loading
                    ? t('admin.certificates.table.loading')
                    : t('admin.certificates.table.count', { count: props.certificates.length })
            }
            description={t('admin.certificates.table.description')}
            searchInput={state.searchInput}
            searchLabel={t('admin.certificates.table.searchLabel')}
            searchPlaceholder={t('admin.certificates.table.searchPlaceholder')}
            showColumnFilters={state.showColumnFilters}
            onSearchChange={handler.handleSearchInputChange}
            onToggleColumnFilters={handler.toggleColumnFilters}
            onResetFilters={handler.handleResetFilters}
            columnFilterConfigs={state.columnFilterConfigs}
            isLoading={props.loading}
            loadingLabel={t('admin.certificates.table.loading')}
            emptyState={{
                title: t('admin.certificates.table.emptyTitle'),
                description: t('admin.certificates.table.emptyDescription'),
                action: (
                    <div className="flex flex-wrap justify-center gap-3">
                        {createAction}
                        {requestAction}
                    </div>
                ),
            }}
            filteredEmptyState={{
                title: t('admin.certificates.table.filteredEmptyTitle'),
                description: t('admin.certificates.table.filteredEmptyDescription'),
            }}
            itemLabel={t('admin.certificates.table.itemLabel')}
            action={
                <div className="flex flex-wrap gap-3">
                    {createAction}
                    {requestAction}
                </div>
            }
            tableMinWidthClassName="min-w-[60rem]"
        />
    )
}

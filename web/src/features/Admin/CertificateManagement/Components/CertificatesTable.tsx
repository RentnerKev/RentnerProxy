import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import DataTable from '../../../../shared/Table'
import useTranslationStore from '../../../../language/useTranslationStore'
import useCertificatesTableLogic from '../Hooks/useCertificatesTableLogic'
import type { CertificateTableProps } from '../Types/certificate-management.types'

export default function CertificatesTable(props: CertificateTableProps) {
    const { t } = useTranslationStore()
    const { state, handler } = useCertificatesTableLogic(props)
    const createAction = props.canCreate ? (
        <button
            type="button"
            className={uiClassNames.button.add}
            onClick={props.onCreate}
            disabled={props.isPending}
        >
            {t('admin.certificates.actions.import')}
        </button>
    ) : undefined
    const requestAction = props.canIssue ? (
        <button
            type="button"
            className={uiClassNames.button.secondary}
            onClick={props.onRequest}
            disabled={props.isPending}
        >
            {t('admin.certificates.actions.request')}
        </button>
    ) : undefined
    return (
        <DataTable
            table={state.table}
            eyebrow={t('admin.certificates.table.eyebrow')}
            title={t('admin.certificates.table.count', { count: props.certificates.length })}
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

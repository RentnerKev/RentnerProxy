import { Plus } from 'lucide-react'
import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { RedirectHostManagementPageViewProps } from '../Types/redirect-host-management.types'
import RedirectHostFormModal from './RedirectHostFormModal'
import RedirectHostsTable from './RedirectHostsTable'
import RedirectRuntimeStatusPanel from './RedirectRuntimeStatusPanel'
export default function RedirectHostManagementPageView({
    logic: { state, handler },
}: RedirectHostManagementPageViewProps) {
    const { t } = useTranslationStore()
    const action = state.canCreate ? (
        <button
            type="button"
            className={uiClassNames.button.add}
            onClick={handler.openCreate}
            disabled={state.isMutating}
        >
            <Plus aria-hidden="true" className="size-4" />
            {t('admin.redirectHosts.actions.add')}
        </button>
    ) : undefined
    return (
        <>
            <PageHeader
                eyebrow={t('admin.redirectHosts.page.eyebrow')}
                title={t('admin.redirectHosts.page.title')}
                description={t('admin.redirectHosts.page.description')}
            />
            <RedirectRuntimeStatusPanel
                canApply={state.canApply}
                isApplying={state.isApplying}
                onApply={handler.apply}
                status={state.runtimeStatus}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.redirectHosts.states.unavailableTitle')}
                    description={t('admin.redirectHosts.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={uiClassNames.button.secondary}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <RedirectHostsTable
                    redirectHosts={state.redirectHosts}
                    loading={state.isLoading}
                    action={action}
                    canUpdate={state.canUpdate}
                    canDelete={state.canDelete}
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    isPending={state.isMutating}
                    onEdit={handler.openEditor}
                    onDelete={handler.openDelete}
                    onDisable={handler.openDisable}
                    onEnable={handler.enable}
                />
            )}
            {state.showCreate ? (
                <RedirectHostFormModal
                    open
                    mode="create"
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canAssignCertificates={state.canAssignCertificates}
                    onOpenChange={handler.setCreateOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.selected ? (
                <RedirectHostFormModal
                    key={state.selected.id}
                    open
                    mode="edit"
                    redirectHost={state.selected}
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canAssignCertificates={state.canAssignCertificates}
                    onOpenChange={handler.setEditorOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteOpen}
                    title={t('admin.redirectHosts.confirm.deleteTitle')}
                    description={
                        <>
                            <span className="block">
                                {t('admin.redirectHosts.confirm.deleteDescription', {
                                    name: state.deleteTarget.domains[0],
                                })}
                            </span>
                            <span className="mt-2 block">
                                {t('admin.redirectHosts.confirm.deleteWarning')}
                            </span>
                        </>
                    }
                    confirmLabel={t('admin.redirectHosts.confirm.deleteLabel')}
                    pendingLabel={t('admin.redirectHosts.actions.deleting')}
                    destructive
                    isPending={state.isDeleting}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
            {state.disableTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDisableOpen}
                    title={t('admin.redirectHosts.confirm.disableTitle')}
                    description={t('admin.redirectHosts.confirm.disableDescription')}
                    confirmLabel={t('admin.redirectHosts.confirm.disableLabel')}
                    pendingLabel={t('admin.redirectHosts.actions.disabling')}
                    destructive
                    isPending={state.isDisabling}
                    onConfirm={handler.confirmDisable}
                />
            ) : null}
        </>
    )
}

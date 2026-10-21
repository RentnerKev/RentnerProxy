import useRedirectHostManagementLogic from './Hooks/useRedirectHostManagementLogic.ts'
import type { RedirectHostManagementPageProps } from './Types/redirect-host-management.types.ts'
import { Plus } from 'lucide-react'
import HostTagManager from '@/features/Admin/HostTags/Components/HostTagManager.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import RedirectHostFormModal from './Components/RedirectHostFormModal/index.tsx'
import RedirectHostsTable from './Components/RedirectHostsTable/index.tsx'
import RedirectRuntimeStatusPanel from './Components/RedirectRuntimeStatusPanel.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
export default function RedirectHostManagementPage(props: RedirectHostManagementPageProps) {
    const { state, handler } = useRedirectHostManagementLogic(props)
    const { t } = useTranslationStore()
    const action = state.canCreate ? (
        <button
            type="button"
            className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
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
                onRetry={handler.retryRuntime}
                status={state.runtimeStatus}
                isError={state.runtimeStatusError}
                isRetrying={state.runtimeStatusRetrying}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.redirectHosts.states.unavailableTitle')}
                    description={t('admin.redirectHosts.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <RedirectHostsTable
                    remote={state.remote}
                    redirectHosts={state.redirectHosts}
                    loading={state.isLoading}
                    action={
                        <>
                            {action}
                            {state.canUpdate ? <HostTagManager kind="redirect" /> : null}
                        </>
                    }
                    canDuplicate={state.canDuplicate}
                    onDuplicate={handler.openDuplicate}
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
            {state.duplicateSource ? (
                <RedirectHostFormModal
                    key={'duplicate-' + state.duplicateSource.id}
                    open
                    mode="duplicate"
                    redirectHost={state.duplicateSource}
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canAssignCertificates={state.canAssignCertificates}
                    onOpenChange={handler.setDuplicateOpen}
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

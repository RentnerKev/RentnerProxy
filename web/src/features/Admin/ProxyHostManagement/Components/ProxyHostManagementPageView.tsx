import { Plus } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import CertificateRequestModal from '../../CertificateManagement/Components/CertificateRequestModal'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import type { ProxyHostManagementPageViewProps } from '../Types/proxy-host-management.types'
import ProxyHostFormModal from './ProxyHostFormModal'
import ProxyConfigEditorModal from './ProxyConfigEditorModal'
import ProxyHostsTable from './ProxyHostsTable'
import ProxyRuntimeStatusPanel from './ProxyRuntimeStatusPanel'

export default function ProxyHostManagementPageView({
    logic: { state, handler },
}: ProxyHostManagementPageViewProps) {
    const { t } = useTranslationStore()
    const createAction = state.canCreate ? (
        <button
            type="button"
            className={uiClassNames.button.add}
            onClick={handler.openCreate}
            disabled={state.isMutating}
        >
            <Plus aria-hidden="true" className="size-4" />
            {t('admin.proxyHosts.actions.add')}
        </button>
    ) : undefined

    return (
        <>
            <PageHeader
                eyebrow={t('admin.proxyHosts.page.eyebrow')}
                title={t('admin.proxyHosts.page.title')}
                description={t('admin.proxyHosts.page.description')}
            />
            <ProxyRuntimeStatusPanel
                canApply={state.canApply}
                isApplying={state.isApplying}
                onApply={handler.apply}
                status={state.runtimeStatus}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.proxyHosts.states.unavailableTitle')}
                    description={t('admin.proxyHosts.states.unavailableDescription')}
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
                <ProxyHostsTable
                    proxyHosts={state.proxyHosts}
                    loading={state.isLoading}
                    action={createAction}
                    canUpdate={state.canUpdate}
                    canDelete={state.canDelete}
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canRequestCertificate={state.canRequestCertificate}
                    isPending={state.isMutating}
                    onEdit={handler.openEditor}
                    onConfig={handler.openConfigEditor}
                    onDelete={handler.openDelete}
                    onDisable={handler.openDisable}
                    onEnable={handler.enable}
                    onRequestCertificate={handler.openCertificateRequest}
                />
            )}
            {state.configTarget ? (
                <ProxyConfigEditorModal
                    key={state.configTarget.id + ':' + state.canAdvancedConfig}
                    proxyHost={state.configTarget}
                    open
                    canEdit={state.canEditConfig}
                    canAdvancedConfig={state.canAdvancedConfig}
                    onOpenChange={handler.setConfigEditorOpen}
                />
            ) : null}
            {state.certificateRequestTarget ? (
                <CertificateRequestModal
                    key={state.certificateRequestTarget.id}
                    open
                    initialDomains={state.certificateRequestTarget.domains}
                    initialName={state.certificateRequestTarget.domains[0] ?? ''}
                    onOpenChange={handler.setCertificateRequestOpen}
                    onSuccess={handler.handleCertificateRequestSuccess}
                />
            ) : null}
            {state.showCreate ? (
                <ProxyHostFormModal
                    open
                    mode="create"
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canAssignCertificates={state.canAssignCertificates}
                    onOpenChange={handler.setCreateOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.selectedProxyHost ? (
                <ProxyHostFormModal
                    key={state.selectedProxyHost.id}
                    open
                    mode="edit"
                    proxyHost={state.selectedProxyHost}
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
                    title={t('admin.proxyHosts.confirm.deleteTitle')}
                    description={
                        <>
                            <span className="block">
                                {t('admin.proxyHosts.confirm.deleteDescription', {
                                    name: state.deleteTarget.domains[0],
                                })}
                            </span>
                            <span className="mt-2 block">
                                {t('admin.proxyHosts.confirm.deleteWarning')}
                            </span>
                        </>
                    }
                    confirmLabel={t('admin.proxyHosts.confirm.deleteLabel')}
                    pendingLabel={t('admin.proxyHosts.actions.deleting')}
                    destructive
                    isPending={state.isDeleting}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
            {state.disableTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDisableOpen}
                    title={t('admin.proxyHosts.confirm.disableTitle')}
                    description={t('admin.proxyHosts.confirm.disableDescription')}
                    confirmLabel={t('admin.proxyHosts.confirm.disableLabel')}
                    pendingLabel={t('admin.proxyHosts.actions.disabling')}
                    destructive
                    isPending={state.isDisabling}
                    onConfirm={handler.confirmDisable}
                />
            ) : null}
        </>
    )
}

import useProxyHostManagementLogic from './Hooks/useProxyHostManagementLogic.ts'
import type { ProxyHostManagementPageProps } from './Types/proxy-host-management.types.ts'
import { Plus, Settings } from 'lucide-react'
import { CustomTooltip } from '@rentnerkev/tooltips/tooltip'
import HostTagManager from '@/features/Admin/HostTags/Components/HostTagManager.tsx'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import CertificateRequestModal from '@/features/Admin/CertificateManagement/Components/CertificateRequestModal/index.tsx'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import ProxyHostFormModal from './Components/ProxyHostFormModal/index.tsx'
import ProxyConfigEditorModal from './Components/ProxyConfigEditorModal/index.tsx'
import ProxyGlobalConfigEditorModal from './Components/ProxyGlobalConfigEditorModal/index.tsx'
import ProxyHostsTable from './Components/ProxyHostsTable/index.tsx'
import ProxyRuntimeStatusPanel from './Components/ProxyRuntimeStatusPanel.tsx'
import RuntimeSupportDownload from '@/features/Admin/RuntimeDiagnostics/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function ProxyHostManagementPage(props: ProxyHostManagementPageProps) {
    const { state, handler } = useProxyHostManagementLogic(props)
    const { t } = useTranslationStore()
    const createAction = state.canCreate ? (
        <button
            type="button"
            className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
            onClick={handler.openCreate}
            disabled={state.isMutating}
        >
            <Plus aria-hidden="true" className="size-4" />
            {t('admin.proxyHosts.actions.add')}
        </button>
    ) : undefined
    const headerAction = (
        <>
            <div className="flex items-center gap-2">
                <CustomTooltip
                    collisionPadding={10}
                    content={
                        <div className="grid gap-1 text-left">
                            <p className="m-0 font-extrabold">
                                {t('admin.proxyHosts.config.open')}
                            </p>
                            <p className="m-0 leading-relaxed text-muted">
                                {t('admin.proxyHosts.config.globalDescription')}
                            </p>
                        </div>
                    }
                >
                    <button
                        type="button"
                        className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-xl border border-border-strong bg-surface-raised text-muted transition-colors hover:border-accent-border hover:bg-surface-hover hover:text-accent-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring motion-reduce:transition-none"
                        aria-label={t('admin.proxyHosts.config.open')}
                        onClick={handler.openGlobalConfig}
                    >
                        <Settings aria-hidden="true" className="size-5" />
                    </button>
                </CustomTooltip>
                <RuntimeSupportDownload permissions={props.permissions} />
            </div>
            {createAction}
            {state.canUpdate ? <HostTagManager kind="proxy" /> : null}
        </>
    )

    return (
        <>
            <PageHeader
                eyebrow={t('admin.proxyHosts.page.eyebrow')}
                title={t('admin.proxyHosts.page.title')}
                description={t('admin.proxyHosts.page.description')}
                action={state.isError ? headerAction : undefined}
            />
            <ProxyRuntimeStatusPanel
                canApply={state.canApply}
                isApplying={state.isApplying}
                onApply={handler.apply}
                onRetry={handler.retryRuntime}
                status={state.runtimeStatus}
                isError={state.runtimeStatusError}
                isRetrying={state.runtimeStatusRetrying}
            />
            {state.isError ? (
                <PageAlert
                    severity="error"
                    title={t('admin.proxyHosts.states.unavailableTitle')}
                    description={t('admin.proxyHosts.states.unavailableDescription')}
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
                <ProxyHostsTable
                    bulkPermissions={props.permissions}
                    remote={state.remote}
                    proxyHosts={state.proxyHosts}
                    loading={state.isLoading}
                    action={headerAction}
                    canUpdate={state.canUpdate}
                    canDuplicate={state.canDuplicate}
                    canDelete={state.canDelete}
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canRequestCertificate={state.canRequestCertificate}
                    isPending={state.isMutating}
                    onEdit={handler.openEditor}
                    onDuplicate={handler.openDuplicate}
                    onConfig={handler.openConfigEditor}
                    onDelete={handler.openDelete}
                    onDisable={handler.openDisable}
                    onEnable={handler.enable}
                    onRequestCertificate={handler.openCertificateRequest}
                />
            )}
            {state.configTarget ? (
                <ProxyConfigEditorModal
                    key={state.configTarget.id}
                    proxyHost={state.configTarget}
                    open
                    canEdit={state.canEditConfig}
                    onOpenChange={handler.setConfigEditorOpen}
                />
            ) : null}
            {state.globalConfigOpen ? (
                <ProxyGlobalConfigEditorModal
                    open
                    canEdit={state.canEditConfig}
                    onOpenChange={handler.setGlobalConfigEditorOpen}
                />
            ) : null}
            {state.certificateRequestTarget ? (
                <CertificateRequestModal
                    key={state.certificateRequestTarget.id}
                    open
                    initialDomains={state.certificateRequestTarget.domains}
                    initialName={state.certificateRequestTarget.domains[0] ?? ''}
                    proxyHostId={state.certificateRequestTarget.id}
                    expectedUpdatedAt={state.certificateRequestTarget.updatedAt.toISOString()}
                    readOnlyDomains
                    certificateJob={state.certificateRequestTarget.certificateJob}
                    onOpenChange={handler.setCertificateRequestOpen}
                    onSuccess={handler.handleCertificateRequestSuccess}
                />
            ) : null}
            {state.showCreate ? (
                <ProxyHostFormModal
                    key={state.duplicateSource?.id ?? 'create'}
                    open
                    mode={state.duplicateSource ? 'duplicate' : 'create'}
                    initialGuideOpen={
                        !state.duplicateSource &&
                        !state.isLoading &&
                        state.remote.rowCount === 0 &&
                        !state.remote.initialState.globalFilter &&
                        state.remote.initialState.columnFilters.length === 0
                    }
                    proxyHost={state.duplicateSource ?? undefined}
                    canEnable={state.canEnable}
                    canDisable={state.canDisable}
                    canAssignCertificates={state.canAssignCertificates}
                    canRequestCertificate={state.canCreateCertificateJob}
                    canAssignPolicies={state.canAssignPolicies}
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
                    canRequestCertificate={state.canCreateCertificateJob}
                    canAssignPolicies={state.canAssignPolicies}
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

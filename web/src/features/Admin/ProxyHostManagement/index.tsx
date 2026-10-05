import useProxyHostManagementLogic from './Hooks/useProxyHostManagementLogic.ts'
import type { ProxyHostManagementPageProps } from './Types/proxy-host-management.types.ts'
import { Plus } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import CertificateRequestModal from '@/features/Admin/CertificateManagement/Components/CertificateRequestModal/index.tsx'
import ContentState from '@/shared/Management/ContentState.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import ProxyHostFormModal from './Components/ProxyHostFormModal/index.tsx'
import ProxyConfigEditorModal from './Components/ProxyConfigEditorModal/index.tsx'
import ProxyGlobalConfigEditorModal from './Components/ProxyGlobalConfigEditorModal/index.tsx'
import ProxyHostsTable from './Components/ProxyHostsTable/index.tsx'
import ProxyRuntimeStatusPanel from './Components/ProxyRuntimeStatusPanel.tsx'

export default function ProxyHostManagementPage(props: ProxyHostManagementPageProps) {
    const { state, handler } = useProxyHostManagementLogic(props)
    const { t } = useTranslationStore()
    const createAction = state.canCreate ? (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
            onClick={handler.openCreate}
            disabled={state.isMutating}
        >
            <Plus aria-hidden="true" className="size-4" />
            {t('admin.proxyHosts.actions.add')}
        </button>
    ) : undefined
    const headerAction = (
        <>
            <button
                type="button"
                className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
                onClick={handler.openGlobalConfig}
            >
                {t('admin.proxyHosts.config.open')}
            </button>
            {createAction}
        </>
    )

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
                onRetry={handler.retryRuntime}
                status={state.runtimeStatus}
                isError={state.runtimeStatusError}
                isRetrying={state.runtimeStatusRetrying}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.proxyHosts.states.unavailableTitle')}
                    description={t('admin.proxyHosts.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-accent-border enabled:hover:text-accent-ring"
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

import { Plus } from 'lucide-react'

import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import PageHeader from '../../../../shared/Management/PageHeader'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import type { AccessPolicyManagementPageViewProps } from '../Types/access-policy-management.types'
import AccessPolicyFormModal from './AccessPolicyFormModal'
import AccessPoliciesTable from './AccessPoliciesTable'
import AccessPolicyRuntimeStatusPanel from './AccessPolicyRuntimeStatusPanel'
import AccessPolicyCredentialsModal from './AccessPolicyCredentialsModal'

export default function AccessPolicyManagementPageView({
    logic: { handler, state },
}: AccessPolicyManagementPageViewProps) {
    const { t } = useTranslationStore()
    const createAction = state.canCreate ? (
        <button
            type="button"
            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none bg-accent text-accent-foreground enabled:hover:bg-accent-hover min-w-[8.5rem] whitespace-nowrap"
            onClick={handler.openCreate}
            disabled={state.isMutating}
        >
            <Plus aria-hidden="true" className="size-4" />
            {t('admin.accessPolicies.actions.add')}
        </button>
    ) : undefined

    return (
        <>
            <PageHeader
                eyebrow={t('admin.accessPolicies.page.eyebrow')}
                title={t('admin.accessPolicies.page.title')}
                description={t('admin.accessPolicies.page.description')}
            />
            <AccessPolicyRuntimeStatusPanel
                canApply={state.canApply}
                isApplying={state.isApplying}
                isError={state.runtimeStatusError}
                isRetrying={state.runtimeStatusRetrying}
                onApply={handler.apply}
                onRetry={handler.retryRuntime}
                status={state.runtimeStatus}
            />
            {state.isError ? (
                <ContentState
                    title={t('admin.accessPolicies.states.unavailableTitle')}
                    description={t('admin.accessPolicies.states.unavailableDescription')}
                    action={
                        <button
                            type="button"
                            className="box-border inline-flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent px-4 py-0 text-sm font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 [&_svg]:shrink-0 transition-[background-color,color,border-color] duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-[0.55] disabled:transform-none border-border-strong bg-surface-raised text-ink-soft enabled:hover:border-brand-600 enabled:hover:text-brand-text"
                            onClick={handler.retry}
                        >
                            {t('common.retry')}
                        </button>
                    }
                />
            ) : (
                <AccessPoliciesTable
                    action={createAction}
                    canDelete={state.canDelete}
                    canViewCredentials={state.canViewCredentials}
                    canUpdate={state.canUpdate}
                    isLoading={state.isLoading}
                    isPending={state.isMutating}
                    onDelete={handler.openDelete}
                    onEdit={handler.openEditor}
                    onCredentials={handler.openCredentials}
                    policies={state.policies}
                />
            )}
            {state.showCreate ? (
                <AccessPolicyFormModal
                    open
                    mode="create"
                    onOpenChange={handler.setCreateOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.selectedPolicy ? (
                <AccessPolicyFormModal
                    key={state.selectedPolicy.id}
                    open
                    mode="edit"
                    policy={state.selectedPolicy}
                    onOpenChange={handler.setEditorOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteOpen}
                    title={t('admin.accessPolicies.confirm.deleteTitle')}
                    description={t('admin.accessPolicies.confirm.deleteDescription', {
                        name: state.deleteTarget.name,
                    })}
                    confirmLabel={t('admin.accessPolicies.actions.delete')}
                    pendingLabel={t('admin.accessPolicies.actions.deleting')}
                    destructive
                    isPending={state.isDeleting}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
            {state.credentialsPolicy ? (
                <AccessPolicyCredentialsModal
                    open
                    canUpdate={state.canUpdate}
                    onAccountsChange={handler.handleAccountsChange}
                    onOpenChange={handler.setCredentialsOpen}
                    policy={state.credentialsPolicy}
                />
            ) : null}
        </>
    )
}

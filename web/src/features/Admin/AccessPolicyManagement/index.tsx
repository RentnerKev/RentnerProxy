import useAccessPolicyManagementLogic from './Hooks/useAccessPolicyManagementLogic.ts'
import type { AccessPolicyManagementPageProps } from './Types/access-policy-management.types.ts'
import { Plus } from 'lucide-react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageAlert from '@/shared/PageAlerts/PageAlert.tsx'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import AccessPolicyFormModal from './Components/AccessPolicyFormModal/index.tsx'
import AccessPoliciesTable from './Components/AccessPoliciesTable/index.tsx'
import AccessPolicyRuntimeStatusPanel from './Components/AccessPolicyRuntimeStatusPanel.tsx'
import AccessPolicyCredentialsModal from './Components/AccessPolicyCredentialsModal/index.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

export default function AccessPolicyManagementPage(props: AccessPolicyManagementPageProps) {
    const { state, handler } = useAccessPolicyManagementLogic(props)
    const { t } = useTranslationStore()
    const createAction = state.canCreate ? (
        <button
            type="button"
            className={buttonClassName('primary', 'min-w-[8.5rem] whitespace-nowrap')}
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
                <PageAlert
                    severity="error"
                    title={t('admin.accessPolicies.states.unavailableTitle')}
                    description={t('admin.accessPolicies.states.unavailableDescription')}
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

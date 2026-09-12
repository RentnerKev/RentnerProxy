import useTranslationStore from '../../../../language/useTranslationStore'
import ContentState from '../../../../shared/Management/ContentState'
import { ConfirmDialog } from '../../../../shared/Modal/Components/ConfirmDialog'
import { Modal } from '../../../../shared/Modal'
import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import { MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY } from '../../../../config/access-policies.config'
import useBasicAuthAccountsLogic from '../Hooks/useBasicAuthAccountsLogic'
import type { BasicAuthAccountsModalProps } from '../Types/basic-auth.types'
import BasicAuthAccountFormModal from './BasicAuthAccountFormModal'
import BasicAuthAccountsTable from './BasicAuthAccountsTable'

export default function AccessPolicyCredentialsModal(props: BasicAuthAccountsModalProps) {
    const { state, handler } = useBasicAuthAccountsLogic(props)
    const { t } = useTranslationStore()
    const accountLimitReached = state.accounts.length >= MAX_BASIC_AUTH_ACCOUNTS_PER_POLICY

    return (
        <>
            <Modal
                open={props.open}
                onOpenChange={handler.handleOpenChange}
                title={t('admin.accessPolicies.basicAuth.title', { name: props.policy.name })}
                description={t('admin.accessPolicies.basicAuth.description')}
                size="lg"
                closeDisabled={state.isDeleting}
                footer={
                    <button
                        type="button"
                        className={uiClassNames.button.secondary}
                        disabled={state.isDeleting}
                        onClick={() => handler.handleOpenChange(false)}
                    >
                        {t('common.cancel')}
                    </button>
                }
            >
                <div className="grid gap-5">
                    <div className="rounded-xl border border-info-text/20 bg-info-bg p-3 text-sm leading-relaxed text-info-text">
                        {t('admin.accessPolicies.basicAuth.form.transportHint')}
                    </div>
                    <section className={uiClassNames.management.card}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className={uiClassNames.technicalLabel}>
                                    {t('admin.accessPolicies.basicAuth.table.eyebrow')}
                                </p>
                                <h2 className="mt-1 text-xl font-extrabold text-ink-soft">
                                    {t('admin.accessPolicies.basicAuth.table.count', {
                                        count: state.accounts.length,
                                    })}
                                </h2>
                                <p className="mt-2 mb-0 text-sm leading-relaxed text-muted">
                                    {t('admin.accessPolicies.basicAuth.table.description')}
                                </p>
                            </div>
                            {props.canUpdate ? (
                                <button
                                    type="button"
                                    className={uiClassNames.button.primary}
                                    disabled={state.isMutating || accountLimitReached}
                                    onClick={handler.openCreate}
                                >
                                    {t('admin.accessPolicies.basicAuth.actions.addAccount')}
                                </button>
                            ) : null}
                        </div>
                        {accountLimitReached ? (
                            <p className="mt-4 mb-0 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-800">
                                {t('admin.accessPolicies.basicAuth.table.limit')}
                            </p>
                        ) : null}
                    </section>
                    {state.isError ? (
                        <ContentState
                            title={t('admin.accessPolicies.basicAuth.states.unavailableTitle')}
                            description={t(
                                'admin.accessPolicies.basicAuth.states.unavailableDescription',
                            )}
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
                    ) : state.isLoading ? (
                        <ContentState
                            busy
                            title={t('admin.accessPolicies.basicAuth.table.loading')}
                            description={t('common.loading')}
                        />
                    ) : (
                        <BasicAuthAccountsTable
                            accounts={state.accounts}
                            canUpdate={props.canUpdate}
                            isPending={state.isMutating}
                            onDelete={handler.openDelete}
                            onEdit={handler.openEdit}
                        />
                    )}
                </div>
            </Modal>
            {state.showForm ? (
                <BasicAuthAccountFormModal
                    open
                    accessPolicyId={props.policy.id}
                    account={state.formAccount ?? undefined}
                    mode={state.formAccount ? 'edit' : 'create'}
                    onOpenChange={handler.setFormOpen}
                    onSuccess={handler.handleFormSuccess}
                />
            ) : null}
            {state.deleteTarget ? (
                <ConfirmDialog
                    open
                    onOpenChange={handler.setDeleteOpen}
                    title={t('admin.accessPolicies.basicAuth.confirm.deleteTitle')}
                    description={t('admin.accessPolicies.basicAuth.confirm.deleteDescription', {
                        username: state.deleteTarget.username,
                    })}
                    confirmLabel={t('admin.accessPolicies.basicAuth.actions.deleteAccount')}
                    pendingLabel={t('admin.accessPolicies.basicAuth.actions.deleting')}
                    destructive
                    isPending={state.isDeleting}
                    onConfirm={handler.confirmDelete}
                />
            ) : null}
        </>
    )
}

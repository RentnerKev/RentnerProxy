import PageHeader from '@/shared/Management/PageHeader.tsx'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import { ConfirmDialog } from '@/shared/Modal/Components/ConfirmDialog.tsx'
import ReauthenticationModal from '@/features/UserSettings/Components/SecuritySettingsPanel/Components/ReauthenticationModal.tsx'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import ProviderEditor from './Components/ProviderEditor.tsx'
import ProviderSetupHelp from './Components/ProviderSetupHelp.tsx'
import useOidcProvidersLogic from './Hooks/useOidcProvidersLogic.ts'

/** Presents the provider snapshot with explicit edit, conflict reload, and reauthentication actions. */
export default function OidcProvidersPage() {
    const { state, handler, form } = useOidcProvidersLogic()
    const { t } = useTranslationStore()
    return (
        <>
            <PageHeader
                eyebrow={t('oidc.eyebrow')}
                title={t('oidc.title')}
                description={t('oidc.description')}
                action={
                    <button
                        type="button"
                        className={buttonClassName('primary')}
                        onClick={handler.handleCreate}
                        disabled={
                            !state.isAvailable || state.isPending || state.providers.length >= 16
                        }
                    >
                        {t('oidc.add')}
                    </button>
                }
            />
            <section className="mb-6 grid gap-3 rounded-2xl border border-border bg-surface-subtle p-5">
                <h2 className="font-bold">{t('oidc.callback')}</h2>
                {state.callbackUrl ? (
                    <div className="flex flex-wrap items-center gap-3">
                        <code className="break-all">{state.callbackUrl}</code>
                        <button
                            type="button"
                            className={buttonClassName('secondary')}
                            onClick={() => {
                                void handler.handleCopy()
                            }}
                        >
                            {t('oidc.copy')}
                        </button>
                    </div>
                ) : state.revision !== null ? (
                    <p className="text-muted">{t('oidc.callbackHint')}</p>
                ) : null}
                <p className="text-sm text-muted">{t('oidc.recovery')}</p>
                <p className="text-sm text-muted">{t('oidc.policy')}</p>
            </section>
            <ProviderSetupHelp />
            <div className="mb-4 flex flex-wrap gap-3">
                <button
                    type="button"
                    className={buttonClassName('secondary')}
                    onClick={() => {
                        void handler.handleRefresh()
                    }}
                    disabled={state.isLoading || state.isPending}
                >
                    {t('oidc.refresh')}
                </button>
            </div>
            {state.isLoading ? (
                <output>{t('common.loading')}</output>
            ) : state.isAvailable && state.providers.length === 0 ? (
                <p className="text-muted">{t('oidc.empty')}</p>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
                {state.providers.map((provider) => (
                    <article
                        key={provider.id}
                        className="grid gap-3 rounded-2xl border border-border bg-surface-subtle p-5"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="font-bold">{provider.name}</h2>
                            <span className="text-sm text-muted">
                                {t(provider.enabled ? 'oidc.enabled' : 'oidc.disabled')}
                            </span>
                        </div>
                        <p className="break-all font-mono text-sm">{provider.issuer}</p>
                        <p className="text-sm text-muted">
                            {t('oidc.bindingCount', { count: provider.bindings.length })}
                        </p>
                        <div className="grid gap-1 border-l-2 border-border pl-3 text-sm">
                            <p>
                                {t(
                                    provider.accountPolicy?.provisioning
                                        ? 'oidc.provisioningOn'
                                        : 'oidc.provisioningOff',
                                )}
                            </p>
                            <p className="text-muted">
                                {t('oidc.rolePolicySummary', {
                                    defaults: provider.accountPolicy?.defaultRoleKeys.length ?? 0,
                                    mappings: provider.accountPolicy?.groupRoleMappings.length ?? 0,
                                })}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className={buttonClassName('secondary')}
                                onClick={() => handler.handleEdit(provider)}
                                disabled={state.isPending || !state.isAvailable}
                            >
                                {t('oidc.edit')}
                            </button>
                            <button
                                type="button"
                                className={buttonClassName('secondary')}
                                onClick={() => {
                                    void handler.handleTest(provider)
                                }}
                                disabled={state.isPending || !state.isAvailable}
                            >
                                {t('oidc.test')}
                            </button>
                            <button
                                type="button"
                                className={buttonClassName('danger')}
                                onClick={() => handler.handleDelete(provider)}
                                disabled={state.isPending || !state.isAvailable}
                            >
                                {t('oidc.delete')}
                            </button>
                        </div>
                    </article>
                ))}
            </div>
            <ProviderEditor state={state} handler={handler} form={form} />
            <ConfirmDialog
                open={Boolean(state.deleteTarget)}
                onOpenChange={(open) => {
                    if (!open) handler.handleDelete(null)
                }}
                title={t('oidc.delete')}
                description={t('oidc.deleteConfirm', { name: state.deleteTarget?.name ?? '' })}
                destructive
                isPending={state.isPending}
                onConfirm={handler.handleConfirmDelete}
            />
            <ConfirmDialog
                open={state.reloadConfirm}
                onOpenChange={handler.handleReloadConfirm}
                title={t('oidc.reloadTitle')}
                description={t('oidc.reloadDescription')}
                destructive
                onConfirm={handler.handleReload}
            />
            <ReauthenticationModal
                open={state.reauthOpen}
                isPending={state.reauthPending}
                value={state.credential}
                onChange={handler.handleCredential}
                onConfirm={() => {
                    void handler.handleReauthenticate()
                }}
                onPasskey={() => {
                    void handler.handleReauthenticate(true)
                }}
                onClose={handler.handleReauthClose}
                onOpenChange={(open) => {
                    if (!open) handler.handleReauthClose()
                }}
            />
        </>
    )
}

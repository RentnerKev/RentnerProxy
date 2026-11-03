import { Link2 } from 'lucide-react'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import FormMessage from '@/shared/Forms/FormMessage.tsx'
import useOidcConnectionsLogic from './Hooks/useOidcConnectionsLogic.ts'
import type { OidcConnectionsPanelProps } from './Types/oidc-connections.types.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'

const buttonClass = buttonClassName('secondary')

export default function OidcConnectionsPanel({ userId, canUpdate }: OidcConnectionsPanelProps) {
    const { t } = useTranslationStore()
    const { state, handler, refs } = useOidcConnectionsLogic(userId, canUpdate)
    const { form: formRef } = refs
    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="oidc-connections-title"
            aria-busy={state.isLoading || state.isPending}
        >
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 basis-64 gap-3">
                    <Link2 aria-hidden="true" className="mt-1 size-6 shrink-0 text-brand-text" />
                    <div>
                        <h2
                            id="oidc-connections-title"
                            className="text-xl font-extrabold text-ink-soft"
                        >
                            {t('account.oidc.title')}
                        </h2>
                        {state.data && !state.data.externallyManaged ? (
                            <p className="mt-2 text-sm leading-relaxed text-muted">
                                {t('account.oidc.description')}
                            </p>
                        ) : null}
                    </div>
                </div>
            </div>
            {!state.canUpdate ? (
                <FormMessage tone="info">account.oidc.noPermission</FormMessage>
            ) : null}
            {state.isLoading ? (
                <output className="mt-6 block text-sm text-muted">
                    {t('account.oidc.loading')}
                </output>
            ) : null}
            {state.error ? (
                <FormMessage tone="error">account.oidc.error.unavailable</FormMessage>
            ) : null}
            {state.message ? (
                <FormMessage
                    tone={
                        state.message === 'account.oidc.unlinkedSuccess' ||
                        state.message === 'account.oidc.linkedSuccess'
                            ? 'success'
                            : state.message === 'account.oidc.pending'
                              ? 'info'
                              : 'error'
                    }
                >
                    {state.message}
                </FormMessage>
            ) : null}
            {state.isNavigating ? (
                <button
                    type="button"
                    className={buttonClass}
                    onClick={handler.handleCancelNavigation}
                >
                    {t('account.oidc.cancel')}
                </button>
            ) : null}
            {state.data?.externallyManaged ? (
                <FormMessage tone="info">account.oidc.external</FormMessage>
            ) : null}
            {state.data?.providers.length === 0 ? (
                <p className="mt-6 text-sm text-muted">{t('account.oidc.empty')}</p>
            ) : null}
            <ul className="mt-6 grid gap-3">
                {state.data?.providers.map((provider) => (
                    <li
                        key={provider.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
                    >
                        <div className="min-w-0">
                            <p className="break-words font-extrabold text-ink-soft">
                                {provider.name}
                            </p>
                            <p className="mt-1 text-sm text-muted">
                                {t(
                                    provider.linked
                                        ? 'account.oidc.linked'
                                        : 'account.oidc.unlinked',
                                )}
                            </p>
                            {!provider.enabled ? (
                                <p className="mt-1 text-sm text-muted">
                                    {t('account.oidc.disabled')}
                                </p>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={
                                state.isPending ||
                                !!state.action ||
                                !state.canUpdate ||
                                state.data?.externallyManaged ||
                                (!provider.linked && !provider.enabled)
                            }
                            onClick={() =>
                                handler.handleRequest(
                                    provider.id,
                                    provider.linked ? 'unlink' : 'link',
                                )
                            }
                            aria-label={`${t(provider.linked ? 'account.oidc.unlink' : 'account.oidc.link')}: ${provider.name}`}
                        >
                            {t(provider.linked ? 'account.oidc.unlink' : 'account.oidc.link')}
                        </button>
                    </li>
                ))}
            </ul>
            <form ref={formRef} method="post" action="/api/auth/oidc/start" hidden>
                <input type="hidden" name="providerId" value={state.action?.providerId ?? ''} />
                <input type="hidden" name="intent" value="link" />
            </form>
        </section>
    )
}

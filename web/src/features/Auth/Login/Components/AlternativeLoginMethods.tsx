import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import { Fingerprint, LogIn } from 'lucide-react'
import FormMessage from '@/shared/Forms/FormMessage.tsx'
import type { AlternativeLoginMethodsProps } from '../Types/login-component-props.types.ts'

/** Shows direct provider choices alongside the independent local passkey sign-in. */
export default function AlternativeLoginMethods({
    state,
    handler,
    refs: { oidcForm: oidcFormRef, oidcProviderId: oidcProviderIdRef },
}: AlternativeLoginMethodsProps) {
    const { t } = useTranslationStore()
    return (
        <div className="mt-3 grid gap-3">
            <form
                ref={oidcFormRef}
                hidden
                method="post"
                action="/api/auth/oidc/start"
                onSubmit={handler.handleOidcSubmit}
            >
                <input ref={oidcProviderIdRef} type="hidden" name="providerId" />
            </form>
            {state.alternativeSignInItems.length > 1 ? (
                <h2 className="mt-2 text-sm font-bold text-muted">{t('auth.moreSignInOptions')}</h2>
            ) : null}
            <div className="grid gap-2">
                {state.alternativeSignInItems.map((item) => (
                    <button
                        type="button"
                        key={item.id}
                        disabled={state.isPending || state.isPasskeyPending}
                        className={buttonClassName(
                            'secondary',
                            'min-h-12 w-full whitespace-normal break-words',
                        )}
                        onClick={() => handler.handleAlternativeSignIn(item.id)}
                    >
                        {item.id === 'passkey' ? (
                            <Fingerprint aria-hidden="true" className="size-4 shrink-0" />
                        ) : (
                            <LogIn aria-hidden="true" className="size-4 shrink-0" />
                        )}
                        {state.isPasskeyPending && item.id === 'passkey'
                            ? t('Checking passkey…')
                            : item.label}
                    </button>
                ))}
            </div>
            {state.isOidcPending ? (
                <div className="grid gap-2">
                    <output className="text-sm text-muted">{t('auth.oidc.continuing')}</output>
                    <button
                        type="button"
                        className={buttonClassName('secondary')}
                        onClick={handler.handleCancelOidc}
                    >
                        {t('auth.oidc.cancel')}
                    </button>
                </div>
            ) : null}
            {state.isProviderCatalogPending ? (
                <output className="text-sm text-muted">{t('auth.oidc.loading')}</output>
            ) : null}
            {state.isProviderCatalogUnavailable ? (
                <div className="grid gap-2">
                    <FormMessage tone="info">auth.oidc.catalogUnavailable</FormMessage>
                </div>
            ) : null}
            {state.alternativeSignInItems.length > 1 ? (
                <p className="text-sm text-muted">{t('auth.oidc.localRecovery')}</p>
            ) : null}
        </div>
    )
}

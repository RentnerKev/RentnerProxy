import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import type { OidcLoginProvidersProps } from '../Types/login-component-props.types.ts'

export default function OidcLoginProviders({ state, onSubmit }: OidcLoginProvidersProps) {
    const { t } = useTranslationStore()
    return (
        <div className="mt-4 grid gap-3">
            {state.oidcFailed ? (
                <p role="alert" className="text-sm text-danger-text">
                    {t('auth.oidc.failed', {
                        defaultValue: 'Sign-in failed. Try again or use your local account.',
                    })}
                </p>
            ) : null}
            {state.oidcProviders.map((provider) => (
                <form
                    key={provider.id}
                    method="post"
                    action="/api/auth/oidc/start"
                    onSubmit={onSubmit}
                >
                    <input type="hidden" name="providerId" value={provider.id} />
                    <button
                        type="submit"
                        className={buttonClassName('secondary', 'w-full')}
                        disabled={state.isPending || state.isPasskeyPending}
                    >
                        {t('auth.oidc.signInWith', {
                            provider: provider.name,
                            defaultValue: 'Sign in with {{provider}}',
                        })}
                    </button>
                </form>
            ))}
        </div>
    )
}

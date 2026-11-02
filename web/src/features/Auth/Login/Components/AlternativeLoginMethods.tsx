import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import { buttonClassName } from '@/shared/Buttons/buttonStyles.ts'
import { Menu } from '@rentnerkev/menu'
import { ChevronDown } from 'lucide-react'
import type { AlternativeLoginMethodsProps } from '../Types/login-component-props.types.ts'

/** Groups passkey and provider actions without exposing credentials or replacing native OIDC navigation. */
export default function AlternativeLoginMethods({
    state,
    handler,
    refs: { oidcForm: oidcFormRef, oidcProviderId: oidcProviderIdRef },
}: AlternativeLoginMethodsProps) {
    const { t } = useTranslationStore()
    return (
        <div className="mt-3">
            <form
                ref={oidcFormRef}
                hidden
                method="post"
                action="/api/auth/oidc/start"
                onSubmit={handler.handleOidcSubmit}
            >
                <input ref={oidcProviderIdRef} type="hidden" name="providerId" />
            </form>
            <Menu
                asChild
                openOnHover
                ariaLabel={t('auth.moreSignInOptions', { defaultValue: 'More sign-in options' })}
                items={state.alternativeSignInItems}
                onAction={handler.handleAlternativeSignIn}
                disabled={state.isPending || state.isPasskeyPending}
                align="center"
                sideOffset={6}
                collisionPadding={8}
                portalZIndex={90}
                classNames={{
                    content:
                        'rounded-xl shadow-panel [--rentner-foreground:var(--theme-ink-soft)] [--rentner-surface:var(--theme-surface-raised)] [--rentner-control:var(--theme-surface-hover)] [--rentner-border:var(--theme-border)] [--rentner-muted:var(--theme-muted)]',
                    item: 'min-h-12 rounded-lg px-3 transition-colors hover:bg-surface-hover aria-disabled:pointer-events-none aria-disabled:opacity-45 motion-reduce:transition-none',
                    label: 'font-bold leading-snug',
                }}
                trigger={
                    <button type="button" className={buttonClassName('secondary', 'w-full')}>
                        {state.isPasskeyPending
                            ? t('Checking passkey…')
                            : t('auth.moreSignInOptions', { defaultValue: 'More sign-in options' })}
                        <ChevronDown aria-hidden="true" className="size-4" />
                    </button>
                }
            />
        </div>
    )
}

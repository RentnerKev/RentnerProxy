import type { AccountIdentityProps } from '../Types/user-settings-component-props.types.ts'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'

export default function AccountIdentity({ user }: AccountIdentityProps) {
    const { t } = useTranslationStore()

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="identity-title"
        >
            <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-accent-ring uppercase">
                {t('account.identity.signedInAs')}
            </p>
            <h2 id="identity-title" className="mt-[0.6rem] text-xl text-ink-soft">
                {user.displayName}
            </h2>
            <p className="mt-[0.4rem] mb-5 text-muted">{user.email}</p>
            <div className="flex flex-wrap gap-[0.45rem]">
                {user.roles.map((role) => (
                    <span
                        className="inline-flex items-center rounded-full border border-success-text/20 bg-success-bg px-[0.6rem] py-[0.28rem] font-mono text-[0.65rem] font-bold text-success-text"
                        key={role}
                    >
                        {role}
                    </span>
                ))}
            </div>
        </section>
    )
}

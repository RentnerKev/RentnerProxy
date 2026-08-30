import type { AccountIdentityProps } from '../Types/user-settings-component-props.types'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../language/useTranslationStore'

export default function AccountIdentity({ user }: AccountIdentityProps) {
    const { t } = useTranslationStore()

    return (
        <section className={uiClassNames.management.card} aria-labelledby="identity-title">
            <p className={uiClassNames.themedTechnicalLabel}>{t('account.identity.signedInAs')}</p>
            <h2 id="identity-title" className="mt-[0.6rem] text-xl text-ink-soft">
                {user.displayName}
            </h2>
            <p className="mt-[0.4rem] mb-5 text-muted">{user.email}</p>
            <div className={uiClassNames.chip.row}>
                {user.roles.map((role) => (
                    <span className={uiClassNames.chip.item} key={role}>
                        {role}
                    </span>
                ))}
            </div>
        </section>
    )
}

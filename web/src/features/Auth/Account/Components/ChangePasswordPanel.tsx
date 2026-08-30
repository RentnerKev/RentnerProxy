import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import useTranslationStore from '../../../../language/useTranslationStore'
import ChangePasswordForm from './ChangePasswordForm'
import useAccountLogic from '../Hooks/useAccountLogic'

export default function ChangePasswordPanel() {
    const { state } = useAccountLogic()
    const { t } = useTranslationStore()

    return (
        <section className={uiClassNames.management.card} aria-labelledby="password-title">
            <p className={uiClassNames.themedTechnicalLabel}>
                {t('account.password.sectionEyebrow')}
            </p>
            <h2 id="password-title" className="mt-[0.6rem] text-xl text-ink-soft">
                {t('account.password.title')}
            </h2>
            <ChangePasswordForm state={state} />
        </section>
    )
}

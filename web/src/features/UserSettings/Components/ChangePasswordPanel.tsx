import useTranslationStore from '../../../language/useTranslationStore'
import ChangePasswordForm from './ChangePasswordForm'
import useChangePasswordLogic from '../Hooks/useChangePasswordLogic'

export default function ChangePasswordPanel() {
    const { state } = useChangePasswordLogic()
    const { t } = useTranslationStore()

    return (
        <section
            className="min-w-0 rounded-2xl border border-border bg-surface p-[clamp(1.15rem,4vw,1.75rem)] shadow-surface"
            aria-labelledby="password-title"
        >
            <p className="m-0 font-mono text-[0.68rem] font-bold tracking-[0.16em] text-brand-text uppercase">
                {t('account.password.sectionEyebrow')}
            </p>
            <h2 id="password-title" className="mt-[0.6rem] text-xl text-ink-soft">
                {t('account.password.title')}
            </h2>
            <ChangePasswordForm state={state} />
        </section>
    )
}

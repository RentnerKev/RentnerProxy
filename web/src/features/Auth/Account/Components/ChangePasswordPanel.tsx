import { uiClassNames } from '../../../../shared/Styles/uiClassNames'
import ChangePasswordForm from './ChangePasswordForm'
import useAccountLogic from '../Hooks/useAccountLogic'

export default function ChangePasswordPanel() {
    const { state } = useAccountLogic()

    return (
        <section className={uiClassNames.management.card} aria-labelledby="password-title">
            <p className={uiClassNames.themedTechnicalLabel}>Credentials</p>
            <h2 id="password-title" className="mt-[0.6rem] text-xl text-ink-soft">
                Change password
            </h2>
            <ChangePasswordForm state={state} />
        </section>
    )
}

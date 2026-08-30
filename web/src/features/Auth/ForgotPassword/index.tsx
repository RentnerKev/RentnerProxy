import { Link } from '@tanstack/react-router'

import AuthShell from '../../../layout/Components/AuthShell'
import ForgotPasswordForm from './Components/ForgotPasswordForm'
import useForgotPasswordLogic from './Hooks/useForgotPasswordLogic'

export default function ForgotPasswordPage() {
    const { state } = useForgotPasswordLogic()

    return (
        <AuthShell
            eyebrow="Account recovery"
            title="Reset access"
            description="Enter the email address for your account. The response stays identical whether an account exists or not."
            footer={
                <>
                    Remembered it? <Link to="/login">Return to sign in</Link>.
                </>
            }
        >
            <ForgotPasswordForm state={state} />
        </AuthShell>
    )
}

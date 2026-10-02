import { Link } from '@tanstack/react-router'

import AuthShell from '@/shared/Auth/AuthShell/index.tsx'
import ForgotPasswordForm from './Components/ForgotPasswordForm.tsx'
import useForgotPasswordLogic from './Hooks/useForgotPasswordLogic.ts'

export default function ForgotPasswordPage() {
    const { state, handler, form } = useForgotPasswordLogic()

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
            <ForgotPasswordForm state={state} form={form} handler={handler} />
        </AuthShell>
    )
}

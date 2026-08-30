import { Link } from '@tanstack/react-router'
import AuthShell from '../../../shared/AuthShell'
import LoginForm from './Components/LoginForm'
import useLoginLogic from './Hooks/useLoginLogic'
export default function LoginPage() {
    const { state, handler } = useLoginLogic()
    return (
        <AuthShell
            eyebrow="Secure access"
            title="Welcome back"
            description="Sign in to manage this RentnerProxy installation. Credentials are verified only on the server."
            footer={
                <>
                    Lost access? <Link to="/forgot-password">Reset your password</Link>.
                </>
            }
        >
            <LoginForm state={state} onPasskeyLogin={handler.handlePasskeyLogin} />
        </AuthShell>
    )
}

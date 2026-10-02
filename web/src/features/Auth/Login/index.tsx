import { Link } from '@tanstack/react-router'
import AuthShell from '@/shared/Auth/AuthShell/index.tsx'
import LoginForm from './Components/LoginForm.tsx'
import useLoginLogic from './Hooks/useLoginLogic.ts'
export default function LoginPage() {
    const { state, handler, form } = useLoginLogic()
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
            <LoginForm
                handler={handler}
                state={state}
                form={form}
                onPasskeyLogin={() => void handler.handlePasskeyLogin()}
            />
        </AuthShell>
    )
}

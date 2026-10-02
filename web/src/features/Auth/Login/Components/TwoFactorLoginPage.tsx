import AuthShell from '@/shared/Auth/AuthShell/index.tsx'
import useTwoFactorLoginLogic from '../Hooks/useTwoFactorLoginLogic.ts'
import TwoFactorLoginForm from './TwoFactorLoginForm.tsx'

export default function TwoFactorLoginPage() {
    const { state, handler, form } = useTwoFactorLoginLogic()
    return (
        <AuthShell
            eyebrow="Additional verification"
            title="Two-factor authentication"
            description="Enter a code to finish signing in."
        >
            {state.isValid ? (
                <TwoFactorLoginForm
                    handler={handler}
                    state={state}
                    form={form}
                    onToggleMode={handler.toggleMode}
                    normalizeCredential={handler.normalizeCredential}
                />
            ) : state.isLoading ? (
                <p className="text-sm text-muted">Checking authentication request…</p>
            ) : (
                <p role="alert" className="text-sm text-danger-text">
                    This authentication request has expired. Start again.
                </p>
            )}
        </AuthShell>
    )
}

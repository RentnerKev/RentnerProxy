import AuthShell from '../../../../layout/Components/AuthShell'
import useTwoFactorLoginLogic from '../Hooks/useTwoFactorLoginLogic'
import TwoFactorLoginForm from './TwoFactorLoginForm'

export default function TwoFactorLoginPage() {
    const { state, handler } = useTwoFactorLoginLogic()
    return (
        <AuthShell
            eyebrow="Additional verification"
            title="Two-factor authentication"
            description="Enter a code to finish signing in."
        >
            {state.isValid ? (
                <TwoFactorLoginForm
                    state={state}
                    onToggleMode={handler.toggleMode}
                    getCredentialError={handler.getCredentialError}
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

import AuthShell from '@/shared/Auth/AuthShell/index.tsx'
import { Link } from '@tanstack/react-router'
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
                <output className="mt-4 block text-sm text-muted">
                    Checking authentication request…
                </output>
            ) : (
                <div className="mt-7 grid gap-4">
                    <p role="alert" className="m-0 text-sm text-danger-text">
                        {state.isStatusError
                            ? 'Authentication service temporarily unavailable. Try again.'
                            : 'This authentication request has expired. Start again.'}
                    </p>
                    {state.isStatusError ? (
                        <button
                            type="button"
                            className="min-h-12 rounded-xl border border-border-strong px-4 py-2 text-sm font-bold text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ring"
                            onClick={handler.handleRetryStatus}
                        >
                            Try again
                        </button>
                    ) : null}
                    <Link to="/login" className="text-center text-sm">
                        Back to sign in
                    </Link>
                </div>
            )}
        </AuthShell>
    )
}

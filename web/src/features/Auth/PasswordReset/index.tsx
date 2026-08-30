import { Link } from '@tanstack/react-router'

import AuthShell from '../../../layout/Components/AuthShell'
import PasswordResetForm from './Components/PasswordResetForm'
import FormMessage from '../../../shared/Forms/FormMessage'
import usePasswordResetLogic from './Hooks/usePasswordResetLogic'

export default function PasswordResetPage() {
    const { state } = usePasswordResetLogic()

    return (
        <AuthShell
            eyebrow="Account recovery"
            title="Choose a new password"
            description="Reset links are short-lived, stored only as hashes, and become unusable after one successful change."
            footer={
                <>
                    No valid link? <Link to="/forgot-password">Request another</Link>.
                </>
            }
        >
            {state.token === undefined ? (
                <FormMessage tone="info">Reading the secure reset link…</FormMessage>
            ) : state.token === null ? (
                <FormMessage tone="error">
                    This page needs a valid reset link from your email.
                </FormMessage>
            ) : (
                <PasswordResetForm state={state} />
            )}
        </AuthShell>
    )
}

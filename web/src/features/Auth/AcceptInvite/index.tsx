import { Link } from '@tanstack/react-router'

import AuthShell from '../../../shared/AuthShell'
import AcceptInviteForm from './Components/AcceptInviteForm'
import FormMessage from '../../../shared/Forms/FormMessage'
import useAcceptInviteLogic from './Hooks/useAcceptInviteLogic'

export default function AcceptInvitePage() {
    const { state } = useAcceptInviteLogic()

    return (
        <AuthShell
            eyebrow="Invitation"
            title="Activate your account"
            description="Confirm how your name appears, choose a password, and turn this one-time invitation into an active account."
            footer={
                <>
                    Already active? <Link to="/login">Sign in instead</Link>.
                </>
            }
        >
            {state.token === undefined ? (
                <FormMessage tone="info">Reading the secure invitation…</FormMessage>
            ) : state.token === null ? (
                <FormMessage tone="error">
                    This page needs a valid invitation from your email.
                </FormMessage>
            ) : (
                <AcceptInviteForm state={state} />
            )}
        </AuthShell>
    )
}

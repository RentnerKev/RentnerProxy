import AuthShell from '../../../layout/Components/AuthShell'
import SetupForm from './Components/SetupForm'
import useSetupLogic from './Hooks/useSetupLogic'

export default function SetupPage() {
    const { state } = useSetupLogic()

    return (
        <AuthShell
            eyebrow="First-run setup"
            title="Create the owner"
            description="Bootstrap this installation with one verified owner account. Setup closes permanently after this step."
            footer="The first-owner transaction is protected by PostgreSQL, even if two setup requests arrive together."
        >
            <SetupForm state={state} />
        </AuthShell>
    )
}

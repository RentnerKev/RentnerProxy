import AuthShell from '@/shared/Auth/AuthShell/index.tsx'
import SetupForm from './Components/SetupForm.tsx'
import useSetupLogic from './Hooks/useSetupLogic.ts'

export default function SetupPage() {
    const { state, handler, form } = useSetupLogic()

    return (
        <AuthShell
            eyebrow="First-run setup"
            title="Create the owner"
            description="Bootstrap this installation with one verified owner account. Setup closes permanently after this step."
            footer="The first-owner transaction is protected by PostgreSQL, even if two setup requests arrive together."
        >
            <SetupForm state={state} form={form} handler={handler} />
        </AuthShell>
    )
}

import PageHeader from '../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import AccountIdentity from './Components/AccountIdentity'
import ChangePasswordPanel from './Components/ChangePasswordPanel'
import type { AccountPageProps } from './Types/account-component-props.types'

export default function AccountPage({ user }: AccountPageProps) {
    return (
        <>
            <PageHeader
                eyebrow="Personal access"
                title="Account"
                description="Change the password for your active session. Every other session is revoked after a successful change."
            />
            <div className={uiClassNames.management.accountGrid}>
                <AccountIdentity user={user} />
                <ChangePasswordPanel />
            </div>
        </>
    )
}

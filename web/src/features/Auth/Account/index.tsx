import PageHeader from '../../../shared/Management/PageHeader'
import { uiClassNames } from '../../../shared/Styles/uiClassNames'
import AccountIdentity from './Components/AccountIdentity'
import ChangePasswordPanel from './Components/ChangePasswordPanel'
import ProfileImagePanel from './Components/ProfileImagePanel'
import { getAccountPageViewModel } from './Helpers/accountPage'
import type { AccountPageProps } from './Types/account-component-props.types'

export default function AccountPage({ user }: AccountPageProps) {
    const viewModel = getAccountPageViewModel(user)

    return (
        <>
            <PageHeader
                eyebrow="Personal access"
                title="Account"
                description="Manage your profile picture and credentials for this RentnerProxy account."
            />
            <div className={uiClassNames.management.accountGrid}>
                <div className="grid gap-4">
                    <AccountIdentity user={user} />
                    <ProfileImagePanel
                        canUpdateProfileImage={viewModel.canUpdateProfileImage}
                        user={user}
                    />
                </div>
                <ChangePasswordPanel />
            </div>
        </>
    )
}

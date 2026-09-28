import useTranslationStore from '../../language/useTranslationStore'
import PageHeader from '../../shared/Management/PageHeader'
import AccountIdentity from './Components/AccountIdentity'
import ChangePasswordPanel from './Components/ChangePasswordPanel'
import LanguageSettingsPanel from './Components/LanguageSettingsPanel'
import ProfileImagePanel from './Components/ProfileImagePanel'
import SecuritySettingsPanel from './Components/SecuritySettingsPanel'
import { getUserSettingsPageViewModel } from './Helpers/userSettingsPage'
import type { UserSettingsPageProps } from './Types/user-settings-component-props.types'

export default function UserSettingsPage({ user }: UserSettingsPageProps) {
    const { t } = useTranslationStore()
    const viewModel = getUserSettingsPageViewModel(user)

    return (
        <>
            <PageHeader
                eyebrow={t('account.page.eyebrow')}
                title={t('account.page.title')}
                description={t('account.page.description')}
            />
            <div className="grid gap-4">
                <div className="grid gap-4 shell:grid-cols-[minmax(16rem,0.7fr)_minmax(24rem,1.3fr)] shell:items-start">
                    <div className="grid gap-4">
                        <AccountIdentity user={user} />
                        <ProfileImagePanel
                            canUpdateProfileImage={viewModel.canUpdateProfileImage}
                            user={user}
                        />
                        <LanguageSettingsPanel />
                    </div>
                    <div className="flex-row gap-4">
                        <ChangePasswordPanel />
                        <div className="mt-4">
                            <SecuritySettingsPanel />
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

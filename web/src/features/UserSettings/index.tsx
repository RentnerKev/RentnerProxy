import { Activity } from 'react'

import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import PageHeader from '@/shared/Management/PageHeader.tsx'
import AccountIdentity from './Components/AccountIdentity.tsx'
import ChangePasswordPanel from './Components/ChangePasswordPanel/index.tsx'
import LanguageSettingsPanel from './Components/LanguageSettingsPanel/index.tsx'
import ProfileImagePanel from './Components/ProfileImagePanel/index.tsx'
import UserAppearancePanel from './Components/UserAppearancePanel/index.tsx'
import SecuritySettingsPanel from './Components/SecuritySettingsPanel/index.tsx'
import UserSettingsNavigation from './Components/UserSettingsNavigation.tsx'
import { getUserSettingsPageViewModel } from '@/lib/UserSettings/userSettingsPage.ts'
import type { UserSettingsPageProps } from './Types/user-settings-component-props.types.ts'

export default function UserSettingsPage({ user, activeSection }: UserSettingsPageProps) {
    const { t } = useTranslationStore()
    const viewModel = getUserSettingsPageViewModel(user)

    return (
        <>
            <PageHeader
                eyebrow={t('account.page.eyebrow')}
                title={t('account.page.title')}
                description={t('account.page.description')}
            />
            <div className="grid items-start gap-5 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-6">
                <UserSettingsNavigation user={user} activeSection={activeSection} />
                <div className="min-w-0">
                    <Activity mode={activeSection === 'profile' ? 'visible' : 'hidden'}>
                        <div className="grid gap-4">
                            <AccountIdentity user={user} />
                            <ProfileImagePanel
                                canUpdateProfileImage={viewModel.canUpdateProfileImage}
                                user={user}
                            />
                        </div>
                    </Activity>
                    <Activity mode={activeSection === 'language' ? 'visible' : 'hidden'}>
                        <LanguageSettingsPanel />
                    </Activity>
                    <Activity mode={activeSection === 'password' ? 'visible' : 'hidden'}>
                        <ChangePasswordPanel />
                    </Activity>
                    <Activity
                        mode={
                            activeSection === 'two-factor' || activeSection === 'passkeys'
                                ? 'visible'
                                : 'hidden'
                        }
                    >
                        <SecuritySettingsPanel
                            section={activeSection === 'passkeys' ? 'passkeys' : 'two-factor'}
                        />
                    </Activity>
                    <Activity mode={activeSection === 'appearance' ? 'visible' : 'hidden'}>
                        <UserAppearancePanel key={user.id} userId={user.id} />
                    </Activity>
                </div>
            </div>
        </>
    )
}

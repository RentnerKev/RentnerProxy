import type { AuthenticatedUser } from '@/lib/Auth/Types/auth.types.ts'
import type { UserSettingsSection } from './user-settings-section.types.ts'

export interface AccountIdentityProps {
    readonly user: AuthenticatedUser
}

export interface UserSettingsPageProps extends AccountIdentityProps {
    readonly activeSection: UserSettingsSection
}

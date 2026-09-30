import type { USER_SETTINGS_SECTIONS } from '../../../config/user-settings.config'

export type UserSettingsSection = (typeof USER_SETTINGS_SECTIONS)[number]

export type SecuritySettingsSection = Extract<UserSettingsSection, 'two-factor' | 'passkeys'>

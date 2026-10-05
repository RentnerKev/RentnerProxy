import type { ApplicationNavigationItem } from '@/layouts/AuthenticatedLayout/Components/ApplicationShell/Types/application-shell.types.ts'
import type { USER_SETTINGS_SECTIONS } from '@/config/user-settings.config.ts'

export type QuickSearchCategory = 'proxyHosts' | 'redirectHosts' | 'certificates' | 'accessPolicies'

export interface QuickSearchInput {
    readonly query: string
    readonly id?: string | undefined
}

export interface QuickSearchEntity {
    readonly id: string
    readonly label: string
    readonly detail: string
}

export type QuickSearchResult = QuickSearchEntity & {
    readonly category: QuickSearchCategory | 'navigation' | 'settings'
    readonly entityId?: string | undefined
} & (
        | { readonly to: ApplicationNavigationItem['to']; readonly section?: never }
        | { readonly to: '/account'; readonly section: (typeof USER_SETTINGS_SECTIONS)[number] }
    )

import getApplicationShellViewModel from '@/lib/ApplicationShell/applicationShell.ts'
import { PERMISSIONS } from '@/config/permissions.config.ts'
import { QUICK_SEARCH_NAVIGATION_LIMIT } from '@/config/quick-search.config.ts'
import { USER_SETTINGS_SECTIONS } from '@/config/user-settings.config.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import type { QuickSearchResult } from './Types/quick-search.types.ts'

export const QUICK_SEARCH_CATEGORIES = [
    { category: 'proxyHosts', permission: PERMISSIONS.PROXY_HOSTS_VIEW, to: '/proxy-hosts' },
    {
        category: 'redirectHosts',
        permission: PERMISSIONS.REDIRECT_HOSTS_VIEW,
        to: '/redirect-hosts',
    },
    { category: 'certificates', permission: PERMISSIONS.CERTIFICATES_VIEW, to: '/certificates' },
    {
        category: 'accessPolicies',
        permission: PERMISSIONS.ACCESS_POLICIES_VIEW,
        to: '/access-policies',
    },
] as const

function normalize(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
}

export function matchesQuickSearch(query: string, text: string): boolean {
    return normalize(query)
        .trim()
        .split(/\s+/)
        .every((term) => normalize(text).includes(term))
}

export function getQuickSearchNavigation(
    permissions: readonly string[],
    query: string,
    t: Translate,
): QuickSearchResult[] {
    const pages: QuickSearchResult[] = getApplicationShellViewModel(
        { permissions },
        t,
    ).navigationItems.map((item) => ({
        id: `navigation:${item.to}`,
        category: 'navigation',
        label: item.label,
        detail: '',
        to: item.to,
    }))
    if (permissions.includes(PERMISSIONS.ACCOUNT_VIEW)) {
        const labels = {
            profile: 'profile',
            language: 'language',
            appearance: 'appearance',
            password: 'password',
            'two-factor': 'twoFactor',
            passkeys: 'passkeys',
        } as const
        for (const section of USER_SETTINGS_SECTIONS) {
            pages.push({
                id: `settings:${section}`,
                category: 'settings',
                label: t(`account.navigation.${labels[section]}`),
                detail: t('quickSearch.categories.settings'),
                to: '/account',
                section,
            })
        }
    }
    return pages
        .filter((item) => matchesQuickSearch(query, `${item.label} ${item.detail}`))
        .slice(0, QUICK_SEARCH_NAVIGATION_LIMIT)
}

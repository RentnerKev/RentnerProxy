import { QUICK_SEARCH_ACTIONS, QUICK_SEARCH_LIMIT } from '@/config/quick-search.config.ts'
import type { Translate } from '@/shared/Language/Types/language.types.ts'
import type { QuickSearchActionId, QuickSearchResult } from './Types/quick-search.types.ts'
import { matchesQuickSearch } from './quickSearchNavigation.ts'

export function canRunQuickSearchAction(
    id: QuickSearchActionId,
    permissions: readonly string[],
): boolean {
    const action = QUICK_SEARCH_ACTIONS.find((item) => item.id === id)
    return !!action && action.permissions.every((permission) => permissions.includes(permission))
}

export function getQuickSearchActions(
    permissions: readonly string[],
    query: string,
    t: Translate,
): QuickSearchResult[] {
    return QUICK_SEARCH_ACTIONS.filter((action) => {
        if (!canRunQuickSearchAction(action.id, permissions)) return false
        const keywords = `${t(action.label)} ${t(action.page)} ${action.keywords} ${t(`quickSearch.keywords.${action.intent}`)} create add new neu neue neuer neues erstellen anlegen hinzufugen ${action.intent === 'import' ? 'import upload importieren hochladen' : ''}`
        return matchesQuickSearch(query, keywords)
    })
        .slice(0, QUICK_SEARCH_LIMIT)
        .map((action) => ({
            id: `action:${action.id}`,
            category: 'actions',
            actionId: action.id,
            label: t(action.label),
            detail: t(action.page),
            to: action.to,
        }))
}

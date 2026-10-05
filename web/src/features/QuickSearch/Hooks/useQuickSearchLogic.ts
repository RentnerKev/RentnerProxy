import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import useTranslationStore from '@/shared/Language/Hooks/useTranslationStore.ts'
import {
    QUICK_SEARCH_DEBOUNCE_MS,
    QUICK_SEARCH_LIMIT,
    QUICK_SEARCH_MAX_QUERY_LENGTH,
    QUICK_SEARCH_MIN_QUERY_LENGTH,
} from '@/config/quick-search.config.ts'
import {
    getQuickSearchNavigation,
    QUICK_SEARCH_CATEGORIES,
} from '@/lib/QuickSearch/quickSearchNavigation.ts'
import type { QuickSearchResult } from '@/lib/QuickSearch/Types/quick-search.types.ts'
import { searchProxyHostsHandler } from '@/features/Admin/ProxyHostManagement/middleware.ts'
import { searchRedirectHostsHandler } from '@/features/Admin/RedirectHostManagement/middleware.ts'
import { searchCertificatesHandler } from '@/features/Admin/CertificateManagement/middleware.ts'
import { searchAccessPoliciesHandler } from '@/features/Admin/AccessPolicyManagement/middleware.ts'
import type { QuickSearchLogicResult, QuickSearchProps } from '../Types/quick-search.types.ts'

const searchHandlers = {
    proxyHosts: searchProxyHostsHandler,
    redirectHosts: searchRedirectHostsHandler,
    certificates: searchCertificatesHandler,
    accessPolicies: searchAccessPoliciesHandler,
}

const unsubscribePlatform = () => undefined
const subscribePlatform = () => unsubscribePlatform
const getShortcut = () => formatForDisplay('Mod+K')
const getServerShortcut = () => 'Ctrl+K'

export default function useQuickSearchLogic({
    userId,
    permissions,
    onNavigate,
}: QuickSearchProps): QuickSearchLogicResult {
    const { t } = useTranslationStore()
    const navigate = useNavigate()
    const id = useId()
    const input = useRef<HTMLInputElement>(null)
    const [inputTarget, setInputTarget] = useState<HTMLInputElement | null>(null)
    const bindInput = useCallback((element: HTMLInputElement | null) => {
        input.current = element
        setInputTarget(element)
    }, [])
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [debouncedQuery, setDebouncedQuery] = useState('')
    const [highlightedId, setHighlightedId] = useState<string | null>(null)
    const [openingScope, setOpeningScope] = useState<string | null>(null)
    const [unavailableScope, setUnavailableScope] = useState<string | null>(null)
    const shortcut = useSyncExternalStore(subscribePlatform, getShortcut, getServerShortcut)
    const attempt = useRef(0)
    const scope = useMemo(
        () => `${userId}:${permissions.toSorted().join(',')}`,
        [userId, permissions],
    )
    const selectionScope = useRef<string | null>(null)
    const isOpening = openingScope === scope
    const targetUnavailable = unavailableScope === scope
    const term = query.trim()
    const canSearch = open && term.length >= QUICK_SEARCH_MIN_QUERY_LENGTH
    const isDebouncing = term !== debouncedQuery

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(term), QUICK_SEARCH_DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
    }, [term])
    useEffect(() => {
        selectionScope.current = scope
        return () => {
            selectionScope.current = null
            attempt.current += 1
        }
    }, [scope])

    const queries = useQueries({
        queries: QUICK_SEARCH_CATEGORIES.map(({ category, permission }) => ({
            queryKey: ['quick-search', scope, category, debouncedQuery],
            queryFn: () => searchHandlers[category]({ data: { query: debouncedQuery } }),
            enabled: canSearch && !isDebouncing && permissions.includes(permission),
            staleTime: 0,
            gcTime: 0,
            retry: false,
        })),
    })
    const results: QuickSearchResult[] = getQuickSearchNavigation(permissions, term, t)
    let hasErrors = false
    let isLoading = canSearch && isDebouncing
    for (const [index, source] of QUICK_SEARCH_CATEGORIES.entries()) {
        const lookup = queries[index]!
        if (!canSearch || isDebouncing || !permissions.includes(source.permission)) continue
        isLoading ||= lookup.isFetching
        hasErrors ||= lookup.isError
        if (lookup.isError) continue
        for (const entity of (lookup.data ?? []).slice(0, QUICK_SEARCH_LIMIT)) {
            results.push({
                ...entity,
                id: `${source.category}:${entity.id}`,
                entityId: entity.id,
                category: source.category,
                to: source.to,
            })
        }
    }
    const active = results.find((result) => result.id === highlightedId) ?? results[0]
    const activeOptionId = active ? `${id}-${active.id}` : undefined
    const groups = (
        ['navigation', 'settings', ...QUICK_SEARCH_CATEGORIES.map((item) => item.category)] as const
    )
        .map((category) => ({
            category,
            label: t(`quickSearch.categories.${category}`),
            results: results
                .filter((result) => result.category === category)
                .map((result) => Object.assign({ optionId: `${id}-${result.id}` }, result)),
        }))
        .filter((group) => group.results.length > 0)

    const changeOpen = useCallback((nextOpen: boolean) => {
        attempt.current += 1
        setOpeningScope(null)
        setUnavailableScope(null)
        setOpen(nextOpen)
        if (!nextOpen) {
            setQuery('')
            setDebouncedQuery('')
            setHighlightedId(null)
        }
    }, [])
    const openSearch = useCallback(() => {
        if (document.querySelector('[role="dialog"][data-state="open"]')) return
        changeOpen(true)
    }, [changeOpen])
    useHotkey(
        'Mod+K',
        (event) => {
            if (document.querySelector('[role="dialog"][data-state="open"]')) return
            event.preventDefault()
            event.stopPropagation()
            changeOpen(true)
        },
        {
            enabled: !open,
            ignoreInputs: true,
            requireReset: true,
            preventDefault: false,
            stopPropagation: false,
        },
    )

    const select = async (result: QuickSearchResult) => {
        if (isOpening) return
        const source = QUICK_SEARCH_CATEGORIES.find((item) => item.category === result.category)
        const selection = ++attempt.current
        setOpeningScope(scope)
        setUnavailableScope(null)
        try {
            if (result.entityId && source) {
                if (!permissions.includes(source.permission)) throw new Error('unavailable')
                const current = await searchHandlers[source.category]({
                    data: { query: term, id: result.entityId },
                })
                if (!current.some((entity) => entity.id === result.entityId))
                    throw new Error('unavailable')
            }
            if (attempt.current !== selection || selectionScope.current !== scope) return
            if (result.to === '/account') {
                await navigate({ to: '/account', search: { section: result.section } })
            } else {
                await navigate({ to: result.to })
            }
            if (attempt.current !== selection) return
            changeOpen(false)
            onNavigate?.()
        } catch {
            if (attempt.current === selection) {
                setUnavailableScope(scope)
                setOpeningScope(null)
                if (source) void queries[QUICK_SEARCH_CATEGORIES.indexOf(source)]?.refetch()
            }
        }
    }
    const move = (direction: number) => {
        if (isOpening || results.length === 0) return
        const index = active ? results.indexOf(active) : 0
        setHighlightedId(results[(index + direction + results.length) % results.length]!.id)
    }
    useHotkey('ArrowDown', () => move(1), {
        target: inputTarget,
        enabled: open && inputTarget !== null,
        ignoreInputs: false,
    })
    useHotkey('ArrowUp', () => move(-1), {
        target: inputTarget,
        enabled: open && inputTarget !== null,
        ignoreInputs: false,
    })
    useHotkey(
        'Enter',
        () => {
            if (active) void select(active)
        },
        { target: inputTarget, enabled: open && inputTarget !== null, ignoreInputs: false },
    )

    useEffect(() => {
        if (!open || !activeOptionId) return
        document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
    }, [open, activeOptionId])

    return {
        state: {
            open,
            query,
            inputId: `${id}-input`,
            listId: `${id}-results`,
            hintId: `${id}-hint`,
            shortcut,
            groups,
            activeOptionId,
            isLoading,
            isOpening,
            hasErrors,
            hasResults: results.length > 0,
            needsQuery: term.length < QUICK_SEARCH_MIN_QUERY_LENGTH,
            targetUnavailable,
            limit: QUICK_SEARCH_LIMIT,
        },
        handler: {
            open: openSearch,
            focusInput: (event) => {
                event.preventDefault()
                input.current?.focus()
            },
            setOpen: changeOpen,
            changeQuery: (value) => {
                attempt.current += 1
                setOpeningScope(null)
                setQuery(value.slice(0, QUICK_SEARCH_MAX_QUERY_LENGTH))
                setHighlightedId(null)
                setUnavailableScope(null)
            },
            highlight: setHighlightedId,
            select: (result) => {
                void select(result)
            },
            retry: () => {
                for (const [index, source] of QUICK_SEARCH_CATEGORIES.entries()) {
                    if (canSearch && !isDebouncing && permissions.includes(source.permission))
                        void queries[index]?.refetch()
                }
            },
        },
        refs: { input: bindInput },
    }
}

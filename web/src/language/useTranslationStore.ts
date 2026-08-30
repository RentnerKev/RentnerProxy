import { useRouterState } from '@tanstack/react-router'
import { createInstance, type InitOptions, type Resource } from 'i18next'
import resourcesToBackend from 'i18next-resources-to-backend'
import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react'

import {
    AVAILABLE_LANGUAGES,
    FALLBACK_LANGUAGE,
    isAppLanguage,
    LANGUAGE_LOCALES,
    LANGUAGE_RESOURCE_LOADERS,
    PUBLIC_ENGLISH,
} from '../config/language.config'

export type AppLanguage = (typeof AVAILABLE_LANGUAGES)[number]
export type Translate = (key: string, options?: Record<string, unknown>) => string
export interface LanguageBootstrap {
    readonly language: AppLanguage
    readonly resources: Resource
}

const languageOptions: InitOptions = {
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: [...AVAILABLE_LANGUAGES],
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
}

function createLanguageInstance(language: AppLanguage, resources?: Resource) {
    const instance = createInstance()
    const ready = instance
        .use(
            resourcesToBackend((value: string) => {
                if (!isAppLanguage(value)) return Promise.reject(new Error('language.loadFailed'))
                return LANGUAGE_RESOURCE_LOADERS[value]()
            }),
        )
        .init({
            ...languageOptions,
            lng: language,
            ...(resources ? { resources: structuredClone(resources) } : {}),
        })
    return { instance, ready }
}

// Only authenticated flows call this; importing the hook loads no catalogs.
export async function loadLanguageBootstrap(value: unknown): Promise<LanguageBootstrap> {
    const { instance, ready } = createLanguageInstance(
        isAppLanguage(value) ? value : FALLBACK_LANGUAGE,
    )
    await ready
    const language = isAppLanguage(instance.resolvedLanguage)
        ? instance.resolvedLanguage
        : FALLBACK_LANGUAGE
    if (!instance.hasResourceBundle(language, 'translation')) {
        throw new Error('language.loadFailed')
    }
    return { language, resources: structuredClone(instance.services.resourceStore.data) }
}

export function createTranslationStore(bootstrap: LanguageBootstrap) {
    const { instance } = createLanguageInstance(bootstrap.language, bootstrap.resources)
    const subscribers = new Set<() => void>()
    let resourceVersion = 0
    const getSnapshot = () => `${instance.resolvedLanguage ?? FALLBACK_LANGUAGE}:${resourceVersion}`
    const serverSnapshot = getSnapshot()

    instance.on('languageChanged loaded', () => {
        resourceVersion += 1
        subscribers.forEach((subscriber) => subscriber())
    })

    return {
        getSnapshot,
        getServerSnapshot: () => serverSnapshot,
        subscribe(subscriber: () => void) {
            subscribers.add(subscriber)
            return () => {
                subscribers.delete(subscriber)
            }
        },
        getTranslate(language: AppLanguage): Translate {
            return (key, options) =>
                String(instance.t(key, { ...options, lng: language, returnObjects: false }))
        },
        async setLanguage(language: AppLanguage, prepared?: LanguageBootstrap) {
            if (!isAppLanguage(language)) throw new Error('language.loadFailed')
            const next = prepared ?? (await loadLanguageBootstrap(language))
            if (next.language !== language) throw new Error('language.loadFailed')
            for (const [resourceLanguage, resource] of Object.entries(next.resources)) {
                instance.addResourceBundle(
                    resourceLanguage,
                    'translation',
                    structuredClone(resource.translation),
                )
            }
            await instance.changeLanguage(language)
        },
    }
}

export type TranslationStore = ReturnType<typeof createTranslationStore>
export const TranslationContext = createContext<TranslationStore | null>(null)

export function AuthenticatedLanguageProvider({
    bootstrap,
    children,
}: {
    readonly bootstrap: LanguageBootstrap
    readonly children: ReactNode
}) {
    // Keyed by user ID in the route: no global language shared by users or SSR requests.
    const [store] = useState(() => createTranslationStore(bootstrap))
    const appliedBootstrap = useRef(bootstrap)
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot,
    )
    const language = snapshot.split(':')[0] ?? FALLBACK_LANGUAGE

    useEffect(() => {
        if (appliedBootstrap.current !== bootstrap) {
            appliedBootstrap.current = bootstrap
            void store.setLanguage(bootstrap.language, bootstrap)
        }
    }, [bootstrap, store])

    useEffect(() => {
        document.documentElement.lang = language
        return () => {
            document.documentElement.lang = FALLBACK_LANGUAGE
        }
    }, [language])

    return createElement(TranslationContext.Provider, { value: store }, children)
}

const translatePublicEnglish: Translate = (key, options) => {
    const template = PUBLIC_ENGLISH[key] ?? String(options?.defaultValue ?? key)
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
        options?.[name] === undefined ? match : String(options[name]),
    )
}

const subscribePublic = () => () => undefined
const getPublicSnapshot = () => `${FALLBACK_LANGUAGE}:0`

export default function useTranslationStore() {
    const store = useContext(TranslationContext)
    const snapshot = useSyncExternalStore(
        store?.subscribe ?? subscribePublic,
        store?.getSnapshot ?? getPublicSnapshot,
        store?.getServerSnapshot ?? getPublicSnapshot,
    )
    const candidate = snapshot.split(':')[0]
    const language = isAppLanguage(candidate) ? candidate : FALLBACK_LANGUAGE
    const t = useMemo(() => {
        const snapshotLanguage = snapshot.split(':')[0]
        return (
            store?.getTranslate(
                isAppLanguage(snapshotLanguage) ? snapshotLanguage : FALLBACK_LANGUAGE,
            ) ?? translatePublicEnglish
        )
    }, [store, snapshot])

    return {
        authenticated: store !== null,
        availableLanguages: AVAILABLE_LANGUAGES,
        language,
        locale: LANGUAGE_LOCALES[language],
        setLanguage: store?.setLanguage,
        t,
    }
}

export function useDateFormatter() {
    const { locale } = useTranslationStore()
    return useMemo(
        () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }),
        [locale],
    )
}

export function useDocumentLanguage() {
    return useRouterState({
        select: (state) => {
            const data: unknown = state.matches.find(
                (match) => match.routeId === '/_authenticated',
            )?.loaderData
            return data &&
                typeof data === 'object' &&
                'language' in data &&
                isAppLanguage(data.language)
                ? data.language
                : FALLBACK_LANGUAGE
        },
    })
}

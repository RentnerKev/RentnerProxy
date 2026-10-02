import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import { AuthenticatedLanguageProvider } from '@/shared/Language/Hooks/useTranslationStore.ts'
import { type AppLanguage, type LanguageBootstrap } from '@/shared/Language/Types/language.types.ts'
import de from '@/lib/Language/Locales/de.json'
import en from '@/lib/Language/Locales/en.json'
import es from '@/lib/Language/Locales/es.json'
import fr from '@/lib/Language/Locales/fr.json'
import it from '@/lib/Language/Locales/it.json'
import pt from '@/lib/Language/Locales/pt.json'
import nl from '@/lib/Language/Locales/nl.json'
import pl from '@/lib/Language/Locales/pl.json'

const catalogs = { en, de, es, fr, it, pt, nl, pl }
const bootstraps: Record<AppLanguage, LanguageBootstrap> = {
    en: { language: 'en', resources: { en: { translation: en } } },
    de: { language: 'de', resources: { en: { translation: en }, de: { translation: de } } },
    es: { language: 'es', resources: { en: { translation: en }, es: { translation: es } } },
    fr: { language: 'fr', resources: { en: { translation: en }, fr: { translation: fr } } },
    it: { language: 'it', resources: { en: { translation: en }, it: { translation: it } } },
    pt: { language: 'pt', resources: { en: { translation: en }, pt: { translation: pt } } },
    nl: { language: 'nl', resources: { en: { translation: en }, nl: { translation: nl } } },
    pl: { language: 'pl', resources: { en: { translation: en }, pl: { translation: pl } } },
}

export { catalogs, bootstraps }

export function withLanguageRoot(root: Root): Root {
    return {
        render: (children) => root.render(withTestLanguage(<>{children}</>)),
        unmount: () => root.unmount(),
    }
}

export default function withTestLanguage(element: ReactElement, language: AppLanguage = 'en') {
    return (
        <AuthenticatedLanguageProvider bootstrap={bootstraps[language]}>
            {element}
        </AuthenticatedLanguageProvider>
    )
}

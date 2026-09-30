import type { ReactElement } from 'react'
import type { Root } from 'react-dom/client'

import {
    AuthenticatedLanguageProvider,
    type AppLanguage,
    type LanguageBootstrap,
} from '../../language/useTranslationStore'
import de from '../../language/Locales/de.json'
import en from '../../language/Locales/en.json'
import es from '../../language/Locales/es.json'
import fr from '../../language/Locales/fr.json'
import it from '../../language/Locales/it.json'
import pt from '../../language/Locales/pt.json'
import nl from '../../language/Locales/nl.json'
import pl from '../../language/Locales/pl.json'

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

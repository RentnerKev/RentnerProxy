export const LANGUAGE_RESOURCE_LOADERS = {
    en: () => import('./Locales/en.json').then((module) => module.default),
    de: () => import('./Locales/de.json').then((module) => module.default),
    es: () => import('./Locales/es.json').then((module) => module.default),
    fr: () => import('./Locales/fr.json').then((module) => module.default),
    it: () => import('./Locales/it.json').then((module) => module.default),
    pt: () => import('./Locales/pt.json').then((module) => module.default),
    nl: () => import('./Locales/nl.json').then((module) => module.default),
    pl: () => import('./Locales/pl.json').then((module) => module.default),
} as const
